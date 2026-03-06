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
  let filterHours = 24;   // active time filter: 24 | 168 (7d) | 720 (30d)
  let verifiedIds = new Set();   // updated by loadHistory, read by setView re-render
  let watchId = null;
  let refreshTimer = null;

  // --- DOM REFS ---
  const historyCount     = document.getElementById('history-count');
  const historyCountNum  = document.getElementById('history-count-num');
  const listView         = document.getElementById('list-view');
  const mapViewContainer = document.getElementById('map-view-container');
  const btnList          = document.getElementById('btn-list');
  const btnMap           = document.getElementById('btn-map');
  const filter24h        = document.getElementById('filter-24h');
  const filter7d         = document.getElementById('filter-7d');
  const filter30d        = document.getElementById('filter-30d');
  const historySummary   = document.getElementById('history-summary');

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
      if (allAlerts.length > 0) renderList(allAlerts, verifiedIds);
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
      html: '<div class="alert-marker-wrap"><div class="alert-marker-pin"><img src="thief2.png" class="alert-marker-icon"></div></div>',
      iconSize: [46, 56],
      iconAnchor: [23, 56],
      popupAnchor: [0, -58],
    });

    const locale = window.appLang === 'en' ? 'en-US' : 'es-ES';
    alerts.forEach(alert => {
      const d = new Date(alert.created_at);
      const dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
      const dist = userPosition
        ? Math.round(haversineDistance(userPosition.lat, userPosition.lng, alert.lat, alert.lng))
        : null;

      const popupHtml = `
        <div style="text-align:center;min-width:160px">
          <img src="thief2.png" style="width:28px;height:28px;object-fit:contain;margin-bottom:4px;display:block;margin:0 auto 4px"><strong style="color:#1a1a1a">${t('history.popup_title')}</strong><br>
          <span style="font-size:12px;color:#555">${dateStr} · ${timeStr}</span>
          ${dist !== null ? `<br><span style="font-size:12px;color:#888">${dist < 1000 ? dist + 'm' : (dist/1000).toFixed(1)+'km'} ${t('history.distance')}</span>` : ''}
          <br><span class="popup-addr" style="font-size:11px;color:#777;display:block;margin-top:4px">${t('history.loading_addr')}</span>
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

  /** Returns the Set of alert IDs that are verified (≥2 distinct users within cluster thresholds) */
  function computeVerifiedSet(alerts) {
    const verified = new Set();
    for (const a of alerts) {
      const aTime = new Date(a.created_at).getTime();
      let corrobCount = 0;
      for (const b of alerts) {
        if (a.id === b.id) continue;
        if (a.user_id && b.user_id && a.user_id === b.user_id) continue;
        const timeDiff = Math.abs(aTime - new Date(b.created_at).getTime()) / 60000;
        if (timeDiff > CLUSTER_TIME_MIN) continue;
        if (haversineDistance(a.lat, a.lng, b.lat, b.lng) <= CLUSTER_RADIUS_M) corrobCount++;
      }
      if (corrobCount >= CLUSTER_MIN_USERS - 1) verified.add(a.id);
    }
    return verified;
  }

  /** Counts distinct geographic zones (cells of ~500m) with at least 1 alert */
  function countActiveZones(alerts) {
    const cells = new Set();
    alerts.forEach(a => {
      const cellLat = Math.round(a.lat * 200) / 200;  // ~500m grid
      const cellLng = Math.round(a.lng * 200) / 200;
      cells.add(`${cellLat},${cellLng}`);
    });
    return cells.size;
  }

  async function loadHistory() {
    if (!userPosition) return;

    const box = getBoundingBox(userPosition.lat, userPosition.lng, HISTORY_RADIUS_M);
    const cutoff = new Date(Date.now() - filterHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('alerts')
      .select('id, lat, lng, created_at, user_id')
      .gte('lat', box.minLat)
      .lte('lat', box.maxLat)
      .gte('lng', box.minLng)
      .lte('lng', box.maxLng)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('[Whistle] loadHistory error:', error);
      renderListError();
      return;
    }

    // Precise Haversine filter
    const within = data.filter(a =>
      haversineDistance(userPosition.lat, userPosition.lng, a.lat, a.lng) <= HISTORY_RADIUS_M
    );

    allAlerts = within;

    // Compute verified set using clustering constants (module-level so setView can reuse)
    verifiedIds = computeVerifiedSet(within);

    // Update count badge
    if (within.length > 0) {
      historyCountNum.textContent = within.length;
      historyCount.classList.remove('hidden');
    } else {
      historyCount.classList.add('hidden');
    }

    // Summary bar
    if (historySummary) {
      if (within.length === 0) {
        historySummary.textContent = t('history.empty_period');
        historySummary.classList.add('visible');
      } else if (within.length === 1) {
        historySummary.textContent = t('history.summary_one');
        historySummary.classList.add('visible');
      } else {
        const zones = countActiveZones(within);
        historySummary.textContent = t('history.summary_many', { n: within.length, z: zones });
        historySummary.classList.add('visible');
      }
    }

    renderList(within, verifiedIds);

    // Also update map markers if map view is active
    if (currentView === 'map' && historyMap) {
      renderMapMarkers(within);
    }
  }

  // ============================================================
  // REVERSE GEOCODING
  // ============================================================

  // In-memory cache
  const geocodeCache = new Map();

  async function reverseGeocode(lat, lng) {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key);

    // Try Photon first (OSM-based, no strict rate limit, browser-friendly)
    try {
      const res = await fetch(
        `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=es`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!res.ok) throw new Error('photon ' + res.status);
      const json = await res.json();
      const props = json.features?.[0]?.properties || {};

      // Use as many fallback fields as possible
      const street  = props.street || props.name || props.locality || '';
      const number  = props.housenumber || '';
      const area    = props.district || props.suburb || props.city || props.county || props.state || '';
      const streetFull = street && number ? `${street}, ${number}` : street;
      const parts = [streetFull, area].filter(Boolean);
      const address = parts.length ? parts.join(' · ') : null;

      if (address) {
        geocodeCache.set(key, address);
        return address;
      }
      throw new Error('no address from photon');
    } catch {
      // Fallback: Nominatim with delay to respect rate limit
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res2 = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1&accept-language=es`,
          { headers: { 'Accept': 'application/json', 'Accept-Language': 'es' } }
        );
        if (!res2.ok) throw new Error('nominatim ' + res2.status);
        const json2 = await res2.json();
        const a = json2.address || {};
        const street = a.road || a.pedestrian || a.footway || a.path || a.cycleway || '';
        const number = a.house_number || '';
        const area   = a.neighbourhood || a.suburb || a.city_district || a.quarter || a.town || a.village || '';
        const streetFull = street && number ? `${street}, ${number}` : street;
        const parts = [streetFull, area].filter(Boolean);
        const address = parts.length
          ? parts.join(' · ')
          : json2.display_name?.split(',').slice(0, 2).join(',').trim() || null;
        geocodeCache.set(key, address);
        return address;
      } catch {
        return null;
      }
    }
  }

  // ============================================================
  // RENDER LIST
  // ============================================================

  function renderList(alerts, verifiedSet = new Set()) {
    if (alerts.length === 0) {
      listView.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>${t('history.empty')}</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('history.empty_sub')}</p>
        </div>`;
      return;
    }

    const locale = window.appLang === 'en' ? 'en-US' : 'es-ES';
    listView.innerHTML = alerts.map((alert) => {
      const isVerified = verifiedSet.has(alert.id);
      const d = new Date(alert.created_at);

      // Full date: dd/mm/yyyy  HH:MM
      const dateStr = d.toLocaleDateString(locale, {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
      const timeStr = d.toLocaleTimeString(locale, {
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
        if (el) el.innerHTML = '<img src="location-pin.png" style="width:13px;height:13px;object-fit:contain;vertical-align:middle;margin-right:3px;opacity:0.7"> ' + (address || `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`);
      });

      // Active = within the same 20-min window as the live radar
      const isActive = ageMin < ALERT_AGE_MIN;

      return `
        <div class="alert-card${isRecent ? ' alert-card--recent' : ''}">
          <img class="card-icon" src="thief2.png" aria-hidden="true">
          <div class="card-body">
            <div class="card-top-row">
              <span class="card-datetime">${fullDateStr}</span>
              ${isVerified ? `<span class="card-verified">${t('history.verified')}</span>` : ''}
              <span class="card-status${isActive ? '' : ' card-status--expired'}">${isActive ? t('history.active') : t('history.expired')}</span>
            </div>
            <div class="card-mid-row">
              <span class="card-distance">${distStr}</span>
              <span class="card-ago${isRecent ? ' card-ago--recent' : ''}">${agoStr}</span>
            </div>
            <div class="card-address-row">
              <span class="card-address" id="${cardId}"><img src="location-pin.png" style="width:13px;height:13px;object-fit:contain;vertical-align:middle;margin-right:3px;opacity:0.7"> ${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function renderListError() {
    listView.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <p>${t('history.error')}</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('history.error_sub')}</p>
        <button class="btn-primary" style="margin-top:16px;font-size:14px;padding:10px 24px" onclick="loadHistory()">${t('history.retry')}</button>
      </div>`;
  }

  // ============================================================
  // GEOLOCATION
  // ============================================================

  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      listView.innerHTML = `<div class="empty-state"><div class="empty-icon">📍</div><p>${t('history.no_gps')}</p></div>`;
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
            <p>${t('history.need_gps')}</p>
            <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('history.need_gps_sub')}</p>
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
    // Filter pills
    function setActiveFilter(active) {
      [filter24h, filter7d, filter30d].forEach(b => b && b.classList.remove('active'));
      if (active) active.classList.add('active');
    }
    if (filter24h) filter24h.addEventListener('click', () => { filterHours = 24;  setActiveFilter(filter24h); loadHistory(); });
    if (filter7d)  filter7d.addEventListener('click',  () => { filterHours = 168; setActiveFilter(filter7d);  loadHistory(); });
    if (filter30d) filter30d.addEventListener('click', () => { filterHours = 720; setActiveFilter(filter30d); loadHistory(); });
    setActiveFilter(filter24h); // default active

    // Toggle buttons
    btnList.addEventListener('click', () => setView('list'));
    btnMap.addEventListener('click', () => {
      if (!userPosition) {
        showToast(t('history.wait_gps'));
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
