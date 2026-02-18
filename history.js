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
      listView.style.display = 'flex';
      mapViewContainer.classList.add('hidden');
    } else {
      btnMap.classList.add('active');
      btnList.classList.remove('active');
      listView.style.display = 'none';
      mapViewContainer.classList.remove('hidden');

      // Initialize history map on first switch
      if (!historyMap) {
        initHistoryMap();
      } else {
        // Refresh size in case layout changed
        historyMap.invalidateSize();
      }
      renderMapMarkers(allAlerts);
    }
  }

  // ============================================================
  // HISTORY MAP
  // ============================================================

  function initHistoryMap() {
    if (!userPosition) return;

    historyMap = L.map('history-map', {
      center: [userPosition.lat, userPosition.lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
      detectRetina: true,
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
      html: '<div class="alert-dot"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    alerts.forEach(alert => {
      const timeStr = new Date(alert.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const dist = userPosition
        ? Math.round(haversineDistance(userPosition.lat, userPosition.lng, alert.lat, alert.lng))
        : null;

      const popup = `
        <div style="text-align:center">
          <strong style="color:#e63946">⚠️ Carterista</strong><br>
          <span style="font-size:12px;color:#555">${timeStr}</span>
          ${dist !== null ? `<br><span style="font-size:12px;color:#888">${dist}m de distancia</span>` : ''}
        </div>`;

      const marker = L.marker([alert.lat, alert.lng], { icon: alertIcon })
        .bindPopup(popup, { maxWidth: 180 })
        .addTo(historyMap);

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
      console.error('[Pickpocket] loadHistory error:', error);
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

    listView.innerHTML = alerts.map((alert, index) => {
      const d = new Date(alert.created_at);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dist = Math.round(
        haversineDistance(userPosition.lat, userPosition.lng, alert.lat, alert.lng)
      );
      const agoStr = formatTimeAgo(alert.created_at);

      // Intensity color based on recency (last 5 min = more vivid)
      const ageMin = (Date.now() - d.getTime()) / 60000;
      const isRecent = ageMin < 5;

      return `
        <div class="alert-card" style="${isRecent ? 'border-color:rgba(230,57,70,0.4)' : ''}">
          <span class="card-time">${timeStr}</span>
          <span class="card-distance">${dist < 1000 ? dist + 'm' : (dist / 1000).toFixed(1) + 'km'}</span>
          <span class="card-coords">${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}</span>
          <span class="card-ago" style="${isRecent ? 'color:var(--accent-orange)' : ''}">${agoStr}</span>
          <span class="card-icon">⚠️</span>
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
        console.warn('[Pickpocket] Geolocation error on history:', err);
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
