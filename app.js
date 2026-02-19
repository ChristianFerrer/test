// ============================================================
// app.js - Live Map Screen Logic - Pickpocket Alert
// ============================================================

(function () {
  'use strict';

  // --- SUPABASE CLIENT ---
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- STATE ---
  // Use Supabase Auth user ID; falls back to anonymous local ID
  let USER_ID = getOrCreateUserId();
  window.__getAuthUserId && window.__getAuthUserId().then(id => { if (id) USER_ID = id; });
  let map = null;
  let userMarker = null;
  let accuracyCircle = null;
  let userPosition = null;          // { lat, lng }
  let alertMarkers = new Map();     // alert.id -> L.Marker
  let alertTimestamps = new Map();  // alert.id -> Date.now() (ms)
  let realtimeChannel = null;
  let isOnCooldown = false;
  let cooldownInterval = null;
  let watchId = null;

  // --- DOM REFS ---
  const permissionOverlay = document.getElementById('permission-overlay');
  const requestLocationBtn = document.getElementById('request-location-btn');
  const gpsDot = document.getElementById('gps-dot');
  const gpsLabel = document.getElementById('gps-label');
  const alertBadge = document.getElementById('alert-badge');
  const bottomPanel = document.getElementById('bottom-panel');
  const panelTitleText = document.getElementById('panel-title-text');
  const panelSubtitle = document.getElementById('panel-subtitle');
  const alertBtn = document.getElementById('alert-btn');
  const btnLabel = document.getElementById('btn-label');

  // ============================================================
  // MAP INITIALIZATION
  // ============================================================

  function initMap(lat, lng) {
    // Make sure the map container is visible before Leaflet initializes
    const mapEl = document.getElementById('map');
    mapEl.style.display = 'block';

    // Fix Leaflet default icon paths to use our local lib/ copies
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl:       'lib/marker-icon.png',
      iconRetinaUrl: 'lib/marker-icon-2x.png',
      shadowUrl:     'lib/marker-shadow.png',
    });

    map = L.map('map', {
      center: [lat, lng],
      zoom: 18,
      zoomControl: false,
      attributionControl: true,
    });

    // Bright tile layer - Waze uses vivid clear maps (OSM standard)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20,
    }).addTo(map);

    // User position marker (pulsing blue dot)
    const userIcon = L.divIcon({
      className: '',
      html: '<div class="user-dot-wrapper"><div class="user-dot"></div></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);

    // Accuracy circle (50m alert radius visualisation)
    accuracyCircle = L.circle([lat, lng], {
      radius: ALERT_RADIUS_M,
      color: '#4cc9f0',
      fillColor: '#4cc9f0',
      fillOpacity: 0.04,
      weight: 1,
      opacity: 0.3,
      dashArray: '4 6',
    }).addTo(map);

    // Force Leaflet to recalculate its size after the overlay is hidden
    setTimeout(() => {
      map.invalidateSize({ animate: false });
      map.setView([lat, lng], 18);
    }, 100);
  }

  // ============================================================
  // USER LOCATION TRACKING
  // ============================================================

  function setGpsStatus(status) {
    // status: 'searching' | 'active' | 'error'
    gpsDot.className = 'gps-dot' + (status === 'active' ? ' active' : status === 'error' ? ' error' : '');
    if (status === 'searching') gpsLabel.textContent = 'Buscando...';
    else if (status === 'active') gpsLabel.textContent = 'GPS activo';
    else gpsLabel.textContent = 'Sin GPS';
  }

  function onPositionSuccess(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const isFirstFix = !userPosition;

    userPosition = { lat, lng };
    setGpsStatus('active');
    permissionOverlay.classList.add('hidden');

    if (isFirstFix) {
      // Small delay ensures the overlay is fully hidden before Leaflet measures the container
      setTimeout(() => {
        initMap(lat, lng);
        loadNearbyAlerts();
        subscribeToAlerts();
      }, 50);
    } else {
      if (userMarker) userMarker.setLatLng([lat, lng]);
      if (accuracyCircle) accuracyCircle.setLatLng([lat, lng]);
      // Re-center map gently if user moved significantly
      if (map) {
        const mapCenter = map.getCenter();
        const moveDist = haversineDistance(mapCenter.lat, mapCenter.lng, lat, lng);
        if (moveDist > 30) {
          map.panTo([lat, lng], { animate: true, duration: 0.5 });
        }
      }
    }
  }

  function onPositionError(err) {
    setGpsStatus('error');
    if (err.code === 1) {
      // Permission denied
      permissionOverlay.classList.remove('hidden');
    } else {
      showToast('Error de GPS: ' + err.message);
    }
  }

  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      showToast('Tu navegador no soporta geolocalización');
      setGpsStatus('error');
      return;
    }

    setGpsStatus('searching');

    watchId = navigator.geolocation.watchPosition(
      onPositionSuccess,
      onPositionError,
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );
  }

  // ============================================================
  // ALERT MARKERS
  // ============================================================

  function createAlertMarker(alert) {
    if (alertMarkers.has(alert.id)) return; // already rendered

    // Yellow diamond marker with thief icon
    const alertIcon = L.divIcon({
      className: '',
      html: '<div class="alert-marker-wrap"><div class="alert-marker-pin"><img src="thief.png" class="alert-marker-icon"></div></div>',
      iconSize: [46, 56],
      iconAnchor: [23, 56],
      popupAnchor: [0, -58],
    });

    const ageMin = Math.floor((Date.now() - new Date(alert.created_at)) / 60000);
    const ageStr = ageMin < 1 ? 'justo ahora' : `hace ${ageMin} min`;

    const marker = L.marker([alert.lat, alert.lng], { icon: alertIcon })
      .bindPopup(
        `<div style="text-align:center;font-family:-apple-system,sans-serif">
          <img src="thief.png" style="width:28px;height:28px;object-fit:contain;display:block;margin:0 auto 6px"><strong style="color:#1a1a1a;font-size:14px">Carterista detectado</strong><br>
          <span style="font-size:12px;color:#555">${ageStr}</span>
        </div>`,
        { maxWidth: 160 }
      )
      .addTo(map);

    alertMarkers.set(alert.id, marker);
    alertTimestamps.set(alert.id, new Date(alert.created_at).getTime());
  }

  function removeAlertMarker(id) {
    const marker = alertMarkers.get(id);
    if (marker && map) {
      map.removeLayer(marker);
    }
    alertMarkers.delete(id);
    alertTimestamps.delete(id);
  }

  function purgeExpiredAlerts() {
    const cutoff = Date.now() - ALERT_AGE_MIN * 60 * 1000;
    alertTimestamps.forEach((ts, id) => {
      if (ts < cutoff) {
        removeAlertMarker(id);
      }
    });
    updateBadgeAndPanel();
  }

  // ============================================================
  // SUPABASE: LOAD INITIAL ALERTS
  // ============================================================

  async function loadNearbyAlerts() {
    if (!userPosition || !map) return;

    const box = getBoundingBox(userPosition.lat, userPosition.lng, ALERT_RADIUS_M);
    const cutoff = new Date(Date.now() - ALERT_AGE_MIN * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('alerts')
      .select('id, lat, lng, created_at, user_id')
      .gte('lat', box.minLat)
      .lte('lat', box.maxLat)
      .gte('lng', box.minLng)
      .lte('lng', box.maxLng)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Whistle] loadNearbyAlerts error:', error);
      return;
    }

    // Precise Haversine filter (bounding box is approximate)
    const nearby = data.filter(a =>
      haversineDistance(userPosition.lat, userPosition.lng, a.lat, a.lng) <= ALERT_RADIUS_M
    );

    nearby.forEach(alert => createAlertMarker(alert));
    updateBadgeAndPanel();
  }

  // ============================================================
  // SUPABASE: REALTIME SUBSCRIPTION
  // ============================================================

  function subscribeToAlerts() {
    if (realtimeChannel) return;

    realtimeChannel = supabase
      .channel('alerts-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => {
          const alert = payload.new;

          // Skip own alerts (already placed optimistically)
          if (alert.user_id === USER_ID) return;
          if (!userPosition || !map) return;

          const dist = haversineDistance(
            userPosition.lat, userPosition.lng,
            alert.lat, alert.lng
          );

          if (dist <= ALERT_RADIUS_M) {
            const ageMin = (Date.now() - new Date(alert.created_at)) / 60000;
            if (ageMin <= ALERT_AGE_MIN) {
              createAlertMarker(alert);
              updateBadgeAndPanel();
              vibrate([200, 100, 200]);
              showToast('🔔 Carterista reportado cerca de ti');
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Whistle] Realtime connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[Whistle] Realtime error, will retry on focus');
          realtimeChannel = null;
        }
      });
  }

  function unsubscribeFromAlerts() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  // ============================================================
  // BADGE & PANEL UPDATE
  // ============================================================

  function updateBadgeAndPanel() {
    const count = alertMarkers.size;

    // Badge
    if (count > 0) {
      alertBadge.textContent = count;
      alertBadge.classList.remove('hidden');
    } else {
      alertBadge.classList.add('hidden');
    }

    // Bottom panel
    if (count > 0) {
      panelTitleText.textContent = count === 1
        ? 'Carterista detectado cerca'
        : `${count} alertas en un radio de 50m`;
      panelSubtitle.textContent = count === 1
        ? 'Hay 1 alerta activa en un radio de 50m'
        : `Hay ${count} alertas activas a tu alrededor`;
      bottomPanel.classList.add('visible');
    } else {
      bottomPanel.classList.remove('visible');
    }
  }

  // ============================================================
  // SEND ALERT
  // ============================================================

  async function sendAlert() {
    if (isOnCooldown) return;

    if (!userPosition) {
      showToast('Esperando señal GPS...');
      return;
    }

    // Visual feedback - flash button
    alertBtn.classList.add('sending');
    setTimeout(() => alertBtn.classList.remove('sending'), 400);

    // Optimistic marker (temp ID)
    const tempId = 'temp_' + Date.now();
    const tempAlert = {
      id: tempId,
      lat: userPosition.lat,
      lng: userPosition.lng,
      created_at: new Date().toISOString(),
      user_id: USER_ID,
    };
    createAlertMarker(tempAlert);
    updateBadgeAndPanel();
    vibrate([100]);

    // Start cooldown UI
    startCooldown();

    // Insert into Supabase
    const { error } = await supabase
      .from('alerts')
      .insert({
        lat: userPosition.lat,
        lng: userPosition.lng,
        user_id: USER_ID,
      });

    if (error) {
      console.error('[Whistle] sendAlert error:', error);
      removeAlertMarker(tempId);
      updateBadgeAndPanel();
      showToast('Error al enviar la alerta. Inténtalo de nuevo.');
    } else {
      showToast('✅ Alerta enviada a usuarios de Whistle cercanos');
    }
  }

  function startCooldown() {
    isOnCooldown = true;
    alertBtn.classList.add('cooldown');

    let remaining = Math.floor(COOLDOWN_MS / 1000);
    btnLabel.textContent = `${remaining}s`;

    cooldownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
        isOnCooldown = false;
        alertBtn.classList.remove('cooldown');
        btnLabel.textContent = '';
      } else {
        btnLabel.textContent = `${remaining}s`;
      }
    }, 1000);
  }

  // ============================================================
  // VISIBILITY CHANGE (re-sync when tab regains focus)
  // ============================================================

  function onVisibilityChange() {
    if (!document.hidden) {
      // Tab became visible again
      purgeExpiredAlerts();
      if (userPosition && map) {
        loadNearbyAlerts();
      }
      if (!realtimeChannel && userPosition) {
        subscribeToAlerts();
      }
    }
  }

  // ============================================================
  // BOOT
  // ============================================================

  function boot() {
    // Permission overlay button
    requestLocationBtn.addEventListener('click', () => {
      permissionOverlay.classList.add('hidden');
      startGeolocation();
    });

    // Alert button
    alertBtn.addEventListener('click', sendAlert);

    // Visibility change
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Cleanup on page leave
    window.addEventListener('beforeunload', () => {
      unsubscribeFromAlerts();
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (cooldownInterval) clearInterval(cooldownInterval);
    });

    // Purge expired markers every 60 seconds
    setInterval(purgeExpiredAlerts, 60 * 1000);

    // Try to start geolocation immediately (if browser has cached permission)
    startGeolocation();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
