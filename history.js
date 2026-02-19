// ============================================================
// history.js - Historical Alerts Screen - Pickpocket Alert
// ============================================================

(function () {
  'use strict';

  // --- SUPABASE CLIENT ---
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- STATE ---
  let userPosition = null;
  let historyMap = null;
  let historyMarkers = [];
  let allAlerts = [];
  let currentView = 'list';
  let watchId = null;
  let refreshTimer = null;

  // --- DOM REFS ---
  const historyCount = document.getElementById('history-count');
  const listView = document.getElementById('list-view');
  const mapViewContainer = document.getElementById('map-view-container');
  const btnList = document.getElementById('btn-list');
  const btnMap = document.getElementById('btn-map');

  // ============================================================
  // VIEW TOGGLE
  // ============================================================

  function setView(view) {
    currentView = view;

    if (view === 'list') {
      btnList.classList.add('active');
      btnMap.classList.remove('active');
      listView.classList.remove('hidden');
      mapViewContainer.classList.add('hidden');
      // Re-render list in case it was stale
      if (allAlerts.length > 0) renderList(allAlerts);
    } else {
      btnMap.classList.add('active');
      btnList.classList.remove('active');
      listView.classList.add('hidden');
      mapViewContainer.classList.remove('hidden');

      // Initialize history map on first switch
      if (!historyMap) {
        initHistoryMap();
      } else {
        // Refresh size in case layout changed
        setTimeout(() => historyMap.invalidateSize(), 50);
      }
      renderMapMarkers(allAlerts);
    }
  }

  // ============================================================
  // HISTORY MAP
  // ============================================================

  function initHistoryMap() {
    if (!userPosition) return;

    // Fix Leaflet default icon paths
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl:       'lib/marker-icon.png',
      iconRetinaUrl: 'lib/marker-icon-2x.png',
      shadowUrl:     'lib/marker-shadow.png',
    });

    historyMap = L.map('history-map', {
      center: [userPosition.lat, userPosition.lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20,
    }).addTo(historyMap);

    // User marker on history map
    const userIcon = L.divIcon({
      className: '',
      html: '<div class="user-dot-wrapper"><div class="user-dot"></div></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    L.marker([userPosition.lat, userPosition.lng], { icon: userIcon, zIndexOffset: 1000 })
      .addTo(historyMap);

    // 5km radius circle
    L.circle([userPosition.lat, userPosition.lng], {
      radius: HISTORY_RADIUS_M,
      color: '#4cc9f0',
      fillColor: '#4cc9f0',
      fillOpacity: 0.03,
      weight: 1,
      opacity: 0.2,
      dashArray: '6 8',
    }).addTo(historyMap);
  }

  function renderMapMarkers(alerts) {
    if (!historyMap) return;

    // Clear existing markers
    historyMarkers.forEach(m => historyMap.removeLayer(m));
    historyMarkers = [];

    const alertIcon = L.divIcon({
      className: '',
      html: '<div class="alert-marker-wrap"><div class="alert-marker-pin"><img src="thief.png" class="alert-marker-icon"></div></div>',
      iconSize: [46, 56],
      iconAnchor: [23, 56],
      popupAnchor: [0, -58],
    });

    alerts.forEach(alert => {
      const d = new Date(alert.created_at);
      const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
      const dist = userPosition
        ? Math.round(haversineDistance(userPosition.lat, userPosition.lng, alert.lat, alert.lng))
        : null;

      const popupHtml = `
        <div style="text-align:center;min-width:160px">
          <img src="thief.png" style="width:28px;height:28px;object-fit:contain;margin-bottom:4px;display:block;margin:0 auto 4px"><strong style="color:#1a1a1a">Carterista detectado</strong><br>
          <span style="font-size:12px;color:#555">${dateStr} · ${timeStr}</span>
          ${dist !== null ? `<br><span style="font-size:12px;color:#888">${dist < 1000 ? dist + 'm' : (dist/1000).toFixed(1)+'km'} de distancia</span>` : ''}
          <br><span class="popup-addr" style="font-size:11px;color:#777;display:block;margin-top:4px">Cargando dirección...</span>
        </div>`;

      const marker = L.marker([alert.lat, alert.lng], { icon: alertIcon })
        .bindPopup(popupHtml, { maxWidth: 200 })
        .addTo(historyMap);

      // Lazy-load address when popup opens
      marker.on('popupopen', () => {
        const addrEl = marker.getPopup().getElement().querySelector('.popup-addr');
        if (addrEl && addrEl.dataset.loaded !== 'true') {
          addrEl.dataset.loaded = 'true';
          reverseGeocode(alert.lat, alert.lng).then(address => {
            if (addrEl) addrEl.textContent = address || `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`;
          });
        }
      });

      historyMarkers.push(marker);
    });

    // Fit bounds to all markers if there are any
    if (historyMarkers.length > 0 && userPosition) {
      const bounds = L.latLngBounds([
        [userPosition.lat, userPosition.lng],
        ...alerts.map(a => [a.lat, a.lng]),
      ]);
      historyMap.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
    }
  }

  // ============================================================
  // LOAD HISTORY FROM SUPABASE
  // ============================================================

  async function loadHistory() {
    if (!userPosition) return;

    const box = getBoundingBox(userPosition.lat, userPosition.lng, HISTORY_RADIUS_M);
    const todayStart = getTodayStart();

    const { data, error } = await supabase
      .from('alerts')
      .select('id, lat, lng, created_at')
      .gte('lat', box.minLat)
      .lte('lat', box.maxLat)
      .gte('lng', box.minLng)
      .lte('lng', box.maxLng)
      .gte('created_at', todayStart)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      console.error('[Whistle] loadHistory error:', error);
      renderListError();
      return;
    }

    // Precise Haversine filter to 5km
    const within5km = data.filter(a =>
      haversineDistance(userPosition.lat, userPosition.lng, a.lat, a.lng) <= HISTORY_RADIUS_M
    );

    allAlerts = within5km;

    // Update count badge
    if (within5km.length > 0) {
      historyCount.textContent = within5km.length;
      historyCount.classList.remove('hidden');
    } else {
      historyCount.classList.add('hidden');
    }

    renderList(within5km);

    // Also update map markers if map view is active
    if (currentView === 'map' && historyMap) {
      renderMapMarkers(within5km);
    }
  }

  // ============================================================
  // REVERSE GEOCODING
  // ============================================================

  // Simple in-memory cache to avoid duplicate Nominatim requests
  const geocodeCache = new Map();

  async function reverseGeocode(lat, lng) {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key);

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`,
        { headers: { 'Accept-Language': 'es' } }
      );
      if (!res.ok) throw new Error('nominatim error');
      const json = await res.json();

      // Build a short readable address: road + suburb/city
      const a = json.address || {};
      const parts = [
        a.road || a.pedestrian || a.footway || a.path,
        a.house_number,
        a.suburb || a.neighbourhood || a.city_district || a.town || a.village || a.city,
      ].filter(Boolean);
      const address = parts.length ? parts.join(' ') : json.display_name.split(',').slice(0, 2).join(',').trim();

      geocodeCache.set(key, address);
      return address;
    } catch {
      return null;
    }
  }

  // ============================================================
  // RENDER LIST
  // ============================================================

  function renderList(alerts) {
    if (alerts.length === 0) {
      listView.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>Sin alertas hoy en un radio de 5km</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">Las alertas aparecerán aquí cuando otros usuarios las reporten</p>
        </div>`;
      return;
    }

    listView.innerHTML = alerts.map((alert) => {
      const d = new Date(alert.created_at);

      // Full date: dd/mm/yyyy  HH:MM
      const dateStr = d.toLocaleDateString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
      const timeStr = d.toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const fullDateStr = `${dateStr} · ${timeStr}`;

      const dist = Math.round(
        haversineDistance(userPosition.lat, userPosition.lng, alert.lat, alert.lng)
      );
      const distStr = dist < 1000 ? dist + 'm' : (dist / 1000).toFixed(1) + 'km';
      const agoStr = formatTimeAgo(alert.created_at);

      // Intensity color based on recency (last 5 min = more vivid)
      const ageMin = (Date.now() - d.getTime()) / 60000;
      const isRecent = ageMin < 5;

      // Render card immediately with coords as placeholder, then swap in address
      const cardId = `card-addr-${alert.id}`;

      // Kick off geocode asynchronously and patch the DOM when ready
      reverseGeocode(alert.lat, alert.lng).then(address => {
        const el = document.getElementById(cardId);
        if (el) el.textContent = '📍 ' + (address || `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`);
      });

      return `
        <div class="alert-card${isRecent ? ' alert-card--recent' : ''}">
          <img class="card-icon" src="thief.png" aria-hidden="true">
          <div class="card-body">
            <div class="card-main">
              <span class="card-datetime">${fullDateStr}</span>
              <span class="card-distance">${distStr}</span>
            </div>
            <div class="card-address-row">
              <span class="card-address" id="${cardId}">📍 ${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}</span>
            </div>
            <div class="card-footer">
              <span class="card-ago${isRecent ? ' card-ago--recent' : ''}">${agoStr}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function renderListError() {
    listView.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <p>Error al cargar el historial</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px">Verifica tu conexión e inténtalo de nuevo</p>
        <button class="btn-primary" style="margin-top:16px;font-size:14px;padding:10px 24px" onclick="loadHistory()">Reintentar</button>
      </div>`;
  }

  // ============================================================
  // GEOLOCATION
  // ============================================================

  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      listView.innerHTML = `<div class="empty-state"><div class="empty-icon">📍</div><p>Geolocalización no disponible</p></div>`;
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        loadHistory();
        // Auto-refresh every 2 minutes
        refreshTimer = setInterval(loadHistory, 2 * 60 * 1000);
      },
      (err) => {
        console.warn('[Whistle] Geolocation error on history:', err);
        listView.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📍</div>
            <p>Necesitamos tu ubicación</p>
            <p style="font-size:12px;color:var(--text-muted);margin-top:4px">Activa el GPS para ver el historial de tu zona</p>
          </div>`;
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30000,
        timeout: 15000,
      }
    );
  }

  // ============================================================
  // BOOT
  // ============================================================

  function boot() {
    // Toggle buttons
    btnList.addEventListener('click', () => setView('list'));
    btnMap.addEventListener('click', () => {
      if (!userPosition) {
        showToast('Esperando señal GPS...');
        return;
      }
      setView('map');
    });

    // Cleanup on page leave
    window.addEventListener('beforeunload', () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (refreshTimer) clearInterval(refreshTimer);
    });

    // Refresh on visibility change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && userPosition) {
        loadHistory();
      }
    });

    startGeolocation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
