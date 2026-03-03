// ============================================================
// app.js - Live Map Screen Logic - Pickpocket Alert
// ============================================================

(function () {
  'use strict';

  // --- SUPABASE CLIENT ---
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- ALERT SOUND ---
  // iOS/PC require audio to be unlocked by a user gesture first.
  // We create + silently play the audio on the first tap anywhere,
  // so subsequent programmatic plays are always allowed.
  let alertAudio = null;
  let audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      alertAudio = new Audio('pickpoket.wav');
      alertAudio.volume = 0;
      alertAudio.play().then(() => {
        alertAudio.pause();
        alertAudio.currentTime = 0;
        alertAudio.volume = 1.0;
      }).catch(() => {});
    } catch (e) {}
  }

  function playAlertSound() {
    try {
      if (!alertAudio) {
        alertAudio = new Audio('pickpoket.wav');
        alertAudio.volume = 1.0;
      }
      alertAudio.currentTime = 0;
      alertAudio.play().catch(() => {/* autoplay still blocked */});
    } catch (err) {
      console.warn('[Whistle] Could not play sound:', err);
    }
  }

  // Unlock audio context on first user interaction (required by iOS + Chrome)
  document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  document.addEventListener('click',      unlockAudio, { once: true, passive: true });

  // Listen for PLAY_WHISTLE message from service worker (push while app is open)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'PLAY_WHISTLE') {
        playAlertSound();
      }
    });
  }

  // --- STATE ---
  // Use Supabase Auth user ID; falls back to anonymous local ID
  let USER_ID = getOrCreateUserId();
  let pushInitialized = false;
  window.__getAuthUserId && window.__getAuthUserId().then(id => { if (id) USER_ID = id; });
  let map = null;
  let userMarker = null;
  let accuracyCircle = null;
  let userPosition = null;          // { lat, lng }
  let alertMarkers = new Map();     // alert.id -> L.Marker
  let alertData    = new Map();     // alert.id -> raw alert object (for clustering)
  let alertTimestamps = new Map();  // alert.id -> Date.now() (ms)
  let realtimeChannel = null;
  let notifiedAlertIds = new Set(); // track alerts already shown to avoid duplicates
  let isOnCooldown = false;
  let cooldownInterval = null;
  let watchId = null;

  // --- HEATMAP STATE ---
  let heatLayer      = null;        // Leaflet.heat layer
  let heatmapVisible = false;       // toggle state
  let heatmapLoaded  = false;       // data already fetched

  // --- OSM CONTEXT LAYER ---
  let osmMarkers        = [];       // L.Marker[] for POIs
  let osmContextLoaded  = false;    // Overpass API already queried

  // --- DOM REFS ---
  const permissionOverlay = document.getElementById('permission-overlay');
  const requestLocationBtn = document.getElementById('request-location-btn');
  const gpsDot = document.getElementById('gps-dot');
  const gpsLabel = document.getElementById('gps-label');
  const alertBadge = document.getElementById('alert-badge');
  const alertBadgeCount = document.getElementById('alert-badge-count');
  const bottomPanel = document.getElementById('bottom-panel');
  const panelTitleText = document.getElementById('panel-title-text');
  const panelSubtitle = document.getElementById('panel-subtitle');
  const alertBtn     = document.getElementById('alert-btn');
  const btnLabel     = document.getElementById('btn-label');
  const heatmapBtn   = document.getElementById('heatmap-btn');
  const riskLegend   = document.getElementById('risk-legend');

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

    // Show heatmap toggle button now that the map is ready
    if (heatmapBtn) heatmapBtn.style.display = 'flex';
  }

  // ============================================================
  // USER LOCATION TRACKING
  // ============================================================

  function setGpsStatus(status) {
    // status: 'searching' | 'active' | 'error'
    gpsDot.className = 'gps-dot' + (status === 'active' ? ' active' : status === 'error' ? ' error' : '');
    if (status === 'searching') gpsLabel.textContent = t('map.gps_searching');
    else if (status === 'active') gpsLabel.textContent = t('map.gps_active');
    else gpsLabel.textContent = t('map.gps_none');
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
        // Init push notifications once on first GPS fix
        if (!pushInitialized && window.initPush) {
          pushInitialized = true;
          window.initPush(USER_ID);
        }
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
      showToast(t('map.gps_error') + err.message);
    }
  }

  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      showToast(t('map.no_gps_browser'));
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

  /** Build a Leaflet divIcon; verified alerts get a green ring + checkmark badge */
  function buildMarkerIcon(verified) {
    const badge = verified ? '<div class="verified-badge">✓</div>' : '';
    const pinCls = verified
      ? 'alert-marker-pin alert-marker-pin--verified'
      : 'alert-marker-pin';
    return L.divIcon({
      className: '',
      html: `<div class="alert-marker-wrap">${badge}<div class="${pinCls}"><img src="thief2.png" class="alert-marker-icon"></div></div>`,
      iconSize: [46, 56],
      iconAnchor: [23, 56],
      popupAnchor: [0, -58],
    });
  }

  /** Build popup HTML for an alert */
  function buildPopupHtml(alert, verified) {
    const ageMin = Math.floor((Date.now() - new Date(alert.created_at)) / 60000);
    const ageStr = ageMin < 1 ? t('map.popup_ago') : t('map.popup_ago_min', { n: ageMin });
    // Count corroborating alerts (others within cluster distance/time)
    let corroborators = 0;
    if (verified) {
      const aTime = new Date(alert.created_at).getTime();
      alertData.forEach((b) => {
        if (b.id === alert.id) return;
        if (alert.user_id && b.user_id && alert.user_id === b.user_id) return;
        const timeDiff = Math.abs(aTime - new Date(b.created_at).getTime()) / 60000;
        if (timeDiff <= CLUSTER_TIME_MIN &&
            haversineDistance(alert.lat, alert.lng, b.lat, b.lng) <= CLUSTER_RADIUS_M) {
          corroborators++;
        }
      });
    }
    const verifiedHtml = verified
      ? `<div style="color:#2e7d32;font-weight:700;font-size:11px;margin-top:5px">${t('map.verified', { n: corroborators + 1 })}</div>`
      : '';
    return `<div style="text-align:center;font-family:-apple-system,sans-serif;padding:2px 0">
      <img src="thief2.png" style="width:28px;height:28px;object-fit:contain;display:block;margin:0 auto 6px">
      <strong style="color:#1a1a1a;font-size:14px">${t('map.popup_title')}</strong><br>
      <span style="font-size:12px;color:#555">${ageStr}</span>
      ${verifiedHtml}
    </div>`;
  }

  /** Returns the Set of alert IDs that are corroborated by CLUSTER_MIN_USERS distinct users */
  function computeVerifiedSet() {
    const verified = new Set();
    const alerts = Array.from(alertData.values());
    for (const a of alerts) {
      const aTime = new Date(a.created_at).getTime();
      let corrobCount = 0;
      for (const b of alerts) {
        if (a.id === b.id) continue;
        if (a.user_id && b.user_id && a.user_id === b.user_id) continue; // same user
        const timeDiff = Math.abs(aTime - new Date(b.created_at).getTime()) / 60000;
        if (timeDiff > CLUSTER_TIME_MIN) continue;
        if (haversineDistance(a.lat, a.lng, b.lat, b.lng) <= CLUSTER_RADIUS_M) {
          corrobCount++;
        }
      }
      if (corrobCount >= CLUSTER_MIN_USERS - 1) verified.add(a.id);
    }
    return verified;
  }

  /** Recompute verification for all markers and update icons/popups */
  function refreshVerification() {
    const verified = computeVerifiedSet();
    alertData.forEach((alert, id) => {
      const marker = alertMarkers.get(id);
      if (!marker) return;
      const isVerified = verified.has(id);
      marker.setIcon(buildMarkerIcon(isVerified));
      marker.setPopupContent(buildPopupHtml(alert, isVerified));
    });
  }

  function createAlertMarker(alert) {
    if (alertMarkers.has(alert.id)) return; // already rendered

    alertData.set(alert.id, alert); // store raw data for clustering

    const marker = L.marker([alert.lat, alert.lng], { icon: buildMarkerIcon(false) })
      .bindPopup(buildPopupHtml(alert, false), { maxWidth: 180 })
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
    alertData.delete(id);
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

    nearby.forEach(alert => {
      createAlertMarker(alert);
      notifiedAlertIds.add(alert.id); // mark as seen so realtime doesn't re-notify
    });
    refreshVerification(); // compute clusters after all markers are loaded
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
              refreshVerification(); // re-evaluate clusters with the new alert
              updateBadgeAndPanel();
              // Only notify once per unique alert ID
              if (!notifiedAlertIds.has(alert.id)) {
                notifiedAlertIds.add(alert.id);
                vibrate([200, 100, 200]);
                playAlertSound();
                showToast(t('map.nearby_toast'));
              }
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
  // HEATMAP - Risk zones (historical data)
  // ============================================================

  async function loadHeatmapData() {
    if (!userPosition || !map) return;
    showToast(t('map.heatmap_loading'), 2000);

    const box = getBoundingBox(userPosition.lat, userPosition.lng, HEATMAP_RADIUS_M);
    const cutoff = new Date(Date.now() - HEATMAP_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('alerts')
      .select('lat, lng, created_at')
      .gte('lat', box.minLat).lte('lat', box.maxLat)
      .gte('lng', box.minLng).lte('lng', box.maxLng)
      .gte('created_at', cutoff)
      .limit(2000);

    if (error || !data || data.length === 0) return;

    const now = Date.now();
    const points = data.map(a => {
      // Weight: recent alerts = 1.0, alerts 30 days old = 0.1 (linear decay)
      const ageDays = (now - new Date(a.created_at).getTime()) / 86400000;
      const weight  = Math.max(0.1, 1 - ageDays / HEATMAP_DAYS);
      return [a.lat, a.lng, weight];
    });

    if (heatLayer) map.removeLayer(heatLayer);
    heatLayer = L.heatLayer(points, {
      radius: 35,
      blur: 25,
      maxZoom: 17,
      gradient: { 0.4: '#2196F3', 0.65: '#FF9800', 1: '#F44336' },
    });

    heatmapLoaded = true;
    if (heatmapVisible) heatLayer.addTo(map);
  }

  function toggleHeatmap() {
    heatmapVisible = !heatmapVisible;

    if (heatmapVisible) {
      heatmapBtn.classList.add('active');
      heatmapBtn.querySelector('#heatmap-btn-label').textContent = t('map.heatmap_off');
      riskLegend.classList.remove('hidden');
      if (!heatmapLoaded) {
        loadHeatmapData();
      } else if (heatLayer) {
        heatLayer.addTo(map);
      }
      // Load OSM context layer alongside the heatmap
      if (!osmContextLoaded) {
        loadOsmContext().then(() => { if (heatmapVisible) showOsmContext(); });
      } else {
        showOsmContext();
      }
    } else {
      heatmapBtn.classList.remove('active');
      heatmapBtn.querySelector('#heatmap-btn-label').textContent = t('map.heatmap_on');
      riskLegend.classList.add('hidden');
      if (heatLayer) map.removeLayer(heatLayer);
      hideOsmContext();
    }
  }

  // ============================================================
  // OSM CONTEXT LAYER - Points of interest (visual context only)
  // ============================================================

  /** Returns the right emoji for a set of OSM tags */
  function getPoiEmoji(tags) {
    if (tags.public_transport === 'station' || tags.railway === 'station' ||
        tags.railway === 'subway_entrance')                    return '🚇';
    if (tags.amenity === 'bus_station')                        return '🚌';
    if (tags.tourism === 'attraction' || tags.tourism === 'museum' ||
        tags.tourism === 'gallery' || tags.historic)           return '🏛️';
    if (tags.amenity === 'marketplace' || tags.shop === 'market') return '🛒';
    if (tags.shop === 'mall' || tags.shop === 'department_store') return '🏬';
    if (tags.leisure === 'stadium' || tags.leisure === 'sports_centre') return '🏟️';
    if (tags.amenity === 'theatre' || tags.amenity === 'cinema')        return '🎭';
    return '📍';
  }

  async function loadOsmContext() {
    if (!userPosition || osmContextLoaded) return;
    const { lat, lng } = userPosition;

    // Overpass QL: stations, tourist attractions, markets within 6 km
    const q = `[out:json][timeout:20];(
      node["public_transport"="station"]["name"](around:6000,${lat},${lng});
      node["railway"="station"]["name"](around:6000,${lat},${lng});
      node["railway"="subway_entrance"]["name"](around:6000,${lat},${lng});
      node["tourism"="attraction"]["name"](around:6000,${lat},${lng});
      node["tourism"="museum"]["name"](around:6000,${lat},${lng});
      node["amenity"="marketplace"]["name"](around:6000,${lat},${lng});
      node["shop"="mall"]["name"](around:6000,${lat},${lng});
    );out 60;`;

    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: q,
      });
      if (!res.ok) return;
      const json = await res.json();
      osmContextLoaded = true;

      (json.elements || []).forEach(el => {
        if (!el.lat || !el.lon) return;
        const tags  = el.tags || {};
        const emoji = getPoiEmoji(tags);
        const name  = tags.name || '';

        const icon = L.divIcon({
          className: '',
          html: `<div class="osm-poi">${emoji}</div>`,
          iconSize:   [30, 30],
          iconAnchor: [15, 15],
        });

        const marker = L.marker([el.lat, el.lon], { icon, zIndexOffset: -200, interactive: !!name });
        if (name) {
          marker.bindTooltip(name, { direction: 'top', offset: [0, -15], className: 'osm-tooltip' });
        }
        osmMarkers.push(marker);
      });
    } catch (e) {
      console.warn('[Whistle] OSM context failed:', e);
    }
  }

  function showOsmContext() {
    osmMarkers.forEach(m => { if (!map.hasLayer(m)) m.addTo(map); });
  }

  function hideOsmContext() {
    osmMarkers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
  }

  // ============================================================
  // BADGE & PANEL UPDATE
  // ============================================================

  let panelAutoHideTimer = null;

  function showPanel() {
    bottomPanel.classList.add('visible');
    // Auto-hide after 10 seconds
    clearTimeout(panelAutoHideTimer);
    panelAutoHideTimer = setTimeout(() => {
      bottomPanel.classList.remove('visible');
    }, 10000);
  }

  function showOwnAlertPanel() {
    // Subtract 1 to exclude the user's own marker from the "nearby others" count
    const nearby = Math.max(0, alertMarkers.size - 1);
    const panelIcon = document.getElementById('panel-icon');
    bottomPanel.classList.add('bottom-panel--own');
    if (panelIcon) panelIcon.src = 'whistle.png';
    panelTitleText.textContent = t('map.own_panel_title');
    panelSubtitle.textContent = nearby === 0
      ? t('map.own_panel_no_others')
      : nearby === 1
      ? t('map.own_panel_one')
      : t('map.own_panel_many', { n: nearby });
    showPanel();
    setTimeout(() => {
      if (panelIcon) panelIcon.src = 'thief2.png';
      bottomPanel.classList.remove('bottom-panel--own');
    }, 10500);
  }

  function updateBadgeAndPanel() {
    const count = alertMarkers.size;

    // Badge
    if (count > 0) {
      alertBadgeCount.textContent = count;
      alertBadge.classList.remove('hidden');
    } else {
      alertBadge.classList.add('hidden');
    }

    // Notification panel
    if (count > 0) {
      panelTitleText.textContent = count === 1
        ? t('map.panel_title_one')
        : t('map.panel_title_many', { n: count });
      panelSubtitle.textContent = count === 1
        ? t('map.panel_sub_one')
        : t('map.panel_sub_many', { n: count });
      showPanel();
    } else {
      clearTimeout(panelAutoHideTimer);
      bottomPanel.classList.remove('visible');
    }
  }

  // ============================================================
  // SEND ALERT
  // ============================================================

  async function sendAlert() {
    if (isOnCooldown) return;

    if (!userPosition) {
      showToast(t('map.waiting_gps'));
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
    showOwnAlertPanel();
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
      showToast(t('map.send_error'));
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

    // Badge click → show panel again
    alertBadge.addEventListener('click', () => {
      if (alertMarkers.size > 0) showPanel();
    });

    // Heatmap toggle
    if (heatmapBtn) heatmapBtn.addEventListener('click', toggleHeatmap);

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
