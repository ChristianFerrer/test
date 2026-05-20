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
  let filterZone = 'nearby'; // 'nearby' = within radius, 'all' = no geo filter
  let verifiedIds = new Set();   // updated by loadHistory, read by setView re-render
  let watchId = null;
  let refreshTimer = null;

  // --- DOM REFS ---
  const historyCount     = document.getElementById('history-count');
  const historyCountNum  = document.getElementById('history-count-num');
  const listView         = document.getElementById('list-view');
  const mapViewContainer = document.getElementById('map-view-container');
  const hourlyChartSection = document.getElementById('hourly-chart-section');
  const hourlyChart      = document.getElementById('hourly-chart');
  const alertsListContent = document.getElementById('alerts-list-content');
  const alertsSectionTitle = document.getElementById('alerts-section-title');
  const btnList          = document.getElementById('btn-list');
  const btnMap           = document.getElementById('btn-map');
  const historySummary        = document.getElementById('history-summary');
  const filterDropdownWrap   = document.getElementById('filter-dropdown-wrap');
  const filterDropdownBtn    = document.getElementById('filter-dropdown-btn');
  const filterDropdownMenu   = document.getElementById('filter-dropdown-menu');
  const filterDropdownLabel  = document.getElementById('filter-dropdown-label');

  // ============================================================
  // VIEW TOGGLE
  // ============================================================

  /** Position a fixed element right below the toggle bar */
  function positionBelowBar(el) {
    const toggleBar = document.querySelector('.view-toggle-bar');
    const top = toggleBar
      ? toggleBar.offsetTop + toggleBar.offsetHeight
      : 0;
    el.style.top = top + 'px';
  }

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
      repositionList();

      // Initialize history map on first switch
      if (!historyMap) {
        setTimeout(() => {
          initHistoryMap();
          renderMapMarkers(allAlerts);
        }, 50);
      } else {
        // Refresh size in case layout changed
        setTimeout(() => {
          historyMap.invalidateSize();
          renderMapMarkers(allAlerts);
        }, 100);
      }
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
      const points = [
        [userPosition.lat, userPosition.lng],
        ...alerts.map(a => [a.lat, a.lng]),
      ];
      const bounds = L.latLngBounds(points);
      // In "all zones" mode, let the map zoom out to show the farthest alert
      const opts = filterZone === 'all'
        ? { padding: [40, 40] }
        : { padding: [32, 32], maxZoom: 16 };
      historyMap.fitBounds(bounds, opts);
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

    const cutoff = new Date(Date.now() - filterHours * 60 * 60 * 1000).toISOString();
    let query = supabase
      .from('alerts')
      .select('id, lat, lng, created_at, user_id')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(500);

    // Apply geo filter only in "nearby" mode (100m radius)
    if (filterZone === 'nearby') {
      const NEARBY_RADIUS_M = 100;
      const box = getBoundingBox(userPosition.lat, userPosition.lng, NEARBY_RADIUS_M);
      query = query
        .gte('lat', box.minLat)
        .lte('lat', box.maxLat)
        .gte('lng', box.minLng)
        .lte('lng', box.maxLng);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Whistle] loadHistory error:', error);
      renderListError();
      return;
    }

    // Precise Haversine filter only in "nearby" mode (100m)
    const NEARBY_RADIUS_M = 100;
    const within = filterZone === 'nearby'
      ? data.filter(a =>
          haversineDistance(userPosition.lat, userPosition.lng, a.lat, a.lng) <= NEARBY_RADIUS_M
        )
      : data;

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
  // HOURLY CHART
  // ============================================================

  const CHART_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];
  let chartCounts = new Array(24).fill(0);
  let chartPeakVal = 0;
  let selectedBarIdx = -1;
  let chartClickBound = false;

  function handleBarClick(e) {
    const col = e.target.closest('.hourly-bar-col');
    if (!col) return;
    const h = Number(col.dataset.hour);

    const prev = hourlyChart.querySelector('.hourly-bar--selected');
    if (prev) prev.classList.remove('hourly-bar--selected');
    const prevTip = hourlyChart.querySelector('.hourly-bar-tooltip');
    if (prevTip) prevTip.remove();

    if (selectedBarIdx === h) { selectedBarIdx = -1; return; }
    selectedBarIdx = h;

    const bar = col.querySelector('.hourly-bar');
    if (!bar.classList.contains('hourly-bar--peak')) bar.classList.add('hourly-bar--selected');

    const tip = document.createElement('div');
    tip.className = 'hourly-bar-tooltip';
    tip.textContent = `${String(h).padStart(2, '0')}:00 — ${chartCounts[h]} alerta${chartCounts[h] !== 1 ? 's' : ''}`;
    col.appendChild(tip);
  }

  function renderHourlyChart(alerts) {
    if (!hourlyChart || !hourlyChartSection) return;
    if (alerts.length === 0) {
      hourlyChartSection.classList.add('hidden');
      repositionList();
      return;
    }

    chartCounts = new Array(24).fill(0);
    alerts.forEach(a => { chartCounts[new Date(a.created_at).getHours()]++; });

    const max = Math.max(...chartCounts, 1);
    chartPeakVal = Math.max(...chartCounts);
    selectedBarIdx = -1;
    const currentHour = new Date().getHours();

    hourlyChart.innerHTML = chartCounts.map((c, h) => {
      const pct = Math.max((c / max) * 100, 5);
      const isNow = h === currentHour;
      return `<div class="hourly-bar-col" data-hour="${h}" style="position:relative">
        <div class="hourly-bar${isNow ? ' hourly-bar--peak' : ''}" style="height:${pct}%"></div>
      </div>`;
    }).join('');

    // Realtime text
    const rtEl = document.getElementById('horas-realtime');
    if (rtEl) {
      const nowCount = chartCounts[currentHour];
      const detail = nowCount === 0
        ? 'Sin actividad detectada'
        : `${nowCount} alerta${nowCount !== 1 ? 's' : ''} detectada${nowCount !== 1 ? 's' : ''}`;
      rtEl.innerHTML = `<span class="horas-realtime-label">En tiempo real ${String(currentHour).padStart(2, '0')}:00:</span> ${detail}`;
    }

    if (!chartClickBound) {
      hourlyChart.addEventListener('click', handleBarClick);
      chartClickBound = true;
    }

    const labelsEl = document.getElementById('hourly-chart-labels');
    if (labelsEl) {
      labelsEl.innerHTML = Array.from({length: 24}, (_, h) => {
        const show = CHART_LABELS.includes(h);
        return `<span class="hourly-chart-label">${show ? String(h).padStart(2, '0') : ''}</span>`;
      }).join('');
    }

    hourlyChartSection.classList.remove('hidden');
    repositionList();
  }

  /** Adjust alert list top to sit right below the fixed chart section */
  function repositionList() {
    requestAnimationFrame(() => {
      const toggleBar = document.querySelector('.view-toggle-bar');
      const base = toggleBar
        ? toggleBar.offsetTop + toggleBar.offsetHeight
        : document.querySelector('.app-header').offsetHeight + 50;
      // Position chart section flush below toggle bar
      if (hourlyChartSection) hourlyChartSection.style.top = base + 'px';
      const chartH = hourlyChartSection && !hourlyChartSection.classList.contains('hidden')
        ? hourlyChartSection.offsetHeight : 0;
      const titleTop = base + chartH;
      if (alertsSectionTitle) alertsSectionTitle.style.top = titleTop + 'px';
      const titleH = alertsSectionTitle ? alertsSectionTitle.offsetHeight : 0;
      const contentTop = (titleTop + titleH) + 'px';
      listView.style.top = contentTop;
      mapViewContainer.style.top = contentTop;
    });
  }

  // ============================================================
  // RENDER LIST
  // ============================================================

  function renderList(alerts, verifiedSet = new Set()) {
    // Always render the chart
    renderHourlyChart(alerts);

    if (alerts.length === 0) {
      alertsListContent.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
          <p>${t('history.empty')}</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('history.empty_sub')}</p>
        </div>`;
      return;
    }


    const locale = window.appLang === 'en' ? 'en-US' : 'es-ES';
    alertsListContent.innerHTML = alerts.map((alert) => {
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
    alertsListContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
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
      listView.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div><p>${t('history.no_gps')}</p></div>`;
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
            <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
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
    // Filter dropdown
    const periodLabels = { '24': '24h', '168': '7d', '720': '30d' };
    const zoneLabels   = { 'nearby': 'Cerca', 'all': 'Todas' };

    function updateFilterLabel() {
      const pLabel = periodLabels[String(filterHours)] || '24h';
      const zLabel = zoneLabels[filterZone] || 'Cerca';
      if (filterDropdownLabel) filterDropdownLabel.textContent = zLabel + ' · ' + pLabel;
    }

    if (filterDropdownBtn) {
      filterDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !filterDropdownMenu.classList.contains('hidden');
        filterDropdownMenu.classList.toggle('hidden', open);
        filterDropdownWrap.classList.toggle('open', !open);
      });
    }

    // Close dropdown on outside click
    document.addEventListener('click', () => {
      if (filterDropdownMenu && !filterDropdownMenu.classList.contains('hidden')) {
        filterDropdownMenu.classList.add('hidden');
        filterDropdownWrap.classList.remove('open');
      }
    });
    if (filterDropdownMenu) {
      filterDropdownMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    // Radio change handlers
    if (filterDropdownMenu) {
      filterDropdownMenu.querySelectorAll('input[name="zone"]').forEach(r => {
        r.addEventListener('change', () => { filterZone = r.value; updateFilterLabel(); loadHistory(); });
      });
      filterDropdownMenu.querySelectorAll('input[name="period"]').forEach(r => {
        r.addEventListener('change', () => { filterHours = Number(r.value); updateFilterLabel(); loadHistory(); });
      });
    }
    updateFilterLabel();

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
