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
  let radarMarker    = null;
  // Radar animation is always active — no toggle needed
  let lastRadarKey   = '';              // tracks radar size+color to avoid unnecessary DOM rebuilds
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

  // --- SURGE DETECTION STATE ---
  let historicalBaseline = 0;       // avg alerts per 30-min at current hour (last 30 days)

  // --- ZONE INSIGHTS STATE ---
  let zoneLastAlertTime  = null;    // ms-epoch of most recent historical alert in zone
  let zoneInsightsReady  = false;   // true once loadZoneInsights() has resolved

  // --- OWN-ALERT COUNTDOWN STATE ---
  let countdownInterval = null;     // setInterval handle for the 20-min countdown
  let countdownEndTime  = null;     // ms-epoch when the sent alert expires

  // --- OWN-ALERT CANCEL STATE ---
  let ownAlertTempId = null;        // temp marker ID of user's own active alert
  let ownAlertDbId   = null;        // real Supabase UUID of user's own active alert

  // --- PUSH LOCATION UPDATE STATE ---
  let pushLocationUpdateTimeout = null; // debounce handle for position-change updates


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
  const zoneChips    = document.getElementById('zone-chips');
  const zoneScoreChip = document.getElementById('zone-score-chip');
  const zonePeakChip  = document.getElementById('zone-peak-chip');
  const panelOwnDetails   = document.getElementById('panel-own-details');
  const panelOwnReach     = document.getElementById('panel-own-reach');
  const panelOwnUsers     = document.getElementById('panel-own-users');
  const panelOwnCountdown = document.getElementById('panel-own-countdown');
  const cancelBtn         = document.getElementById('btn-cancel-alert');

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

    // CartoDB Voyager - clean Google Maps-like style
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    // User position marker (pulsing blue dot)
    const userIcon = L.divIcon({
      className: '',
      html: '<div class="user-dot-wrapper"><div class="user-pulse"></div><div class="user-dot"></div></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);

    // Radar + pulse resize when user zooms in/out
    map.on('zoomend', updateRadar);

    // Force Leaflet to recalculate its size after the overlay is hidden
    setTimeout(() => {
      map.invalidateSize({ animate: false });
      map.setView([lat, lng], 18);
      updateRadar(); // draw radar once map is fully laid out
    }, 100);

    // heatmap button hidden — functionality unified in "Modo Radar" chip
    if (heatmapBtn) heatmapBtn.style.display = 'none';
  }

  // ============================================================
  // RADAR OVERLAY – animated 100m sweep centred on user
  // ============================================================

  /** Returns the diameter in CSS pixels for ALERT_RADIUS_M at current zoom */
  function getRadarDiamPx(lat) {
    if (!map) return 200;
    const mpp = (40075016.686 * Math.cos(lat * Math.PI / 180))
                / (Math.pow(2, map.getZoom()) * 256);
    return Math.round(ALERT_RADIUS_M / mpp) * 2; // diameter = 2 × radius
  }

  /** Returns RGB channels string for radar colour based on nearby alert count */
  function getRadarRgb(count) {
    if (count === 0)   return '52,199,89';   // green  #34C759 – zona tranquila
    if (count <= 2)    return '255,193,7';   // amber  – 1-2 alertas, precaución
    return              '244,67,54';          // red    – 3+ alertas, actividad elevada
  }

  function buildRadarIcon(lat, rgb) {
    const d = getRadarDiamPx(lat);
    const color = rgb || getRadarRgb(alertMarkers.size);
    const html = `<div class="radar-wrap" style="width:${d}px;height:${d}px;--rc:${color}">
      <div class="radar-fill"></div>
      <div class="radar-sweep"></div>
      <div class="radar-ring"></div>
      <div class="radar-cross-h"></div>
      <div class="radar-cross-v"></div>
    </div>`;
    return L.divIcon({
      className: '',
      html,
      iconSize:   [d, d],
      iconAnchor: [d / 2, d / 2],
    });
  }

  function updateRadar() {
    // Pulse always updates
    updatePulse();
    if (!userPosition || !map) return;
    const { lat, lng } = userPosition;
    const rgb = getRadarRgb(alertMarkers.size);
    const d   = getRadarDiamPx(lat);
    const key = `${d}|${rgb}`;
    if (radarMarker) {
      radarMarker.setLatLng([lat, lng]);
      // Only rebuild icon when size or colour changed to avoid restarting the CSS animation
      if (key !== lastRadarKey) {
        radarMarker.setIcon(buildRadarIcon(lat, rgb));
        lastRadarKey = key;
      }
    } else {
      const icon = buildRadarIcon(lat, rgb);
      lastRadarKey = key;
      radarMarker = L.marker([lat, lng], {
        icon,
        zIndexOffset: -200,   // render below alert markers
        interactive: false,
      }).addTo(map);
    }
  }

  /**
   * updatePulse – injects a @keyframes rule so the .user-pulse ring
   * expands exactly to ALERT_RADIUS_M (100 m) at the current zoom level.
   * The element is 18 px wide (9 px radius); scale = 100m_radius_px / 9.
   */
  function updatePulse() {
    if (!userPosition || !map) return;
    const radiusPx  = getRadarDiamPx(userPosition.lat) / 2;  // 100 m in px
    const dotRadius = 9;                                       // half of 18 px dot
    // box-shadow (1.5px) also scales, so total visual radius = scale*(dotRadius+1.5)
    // Solve for scale so total visual radius = radiusPx
    const scale     = (radiusPx / (dotRadius + 1.5)).toFixed(3);
    const rgb       = getRadarRgb(alertMarkers.size);          // same colour as radar

    // Apply colour variable to the pulse element
    const pulseEl = document.querySelector('.user-pulse');
    if (pulseEl) pulseEl.style.setProperty('--pc', rgb);

    // Inject/update keyframes with the current scale
    let styleEl = document.getElementById('pulse-keyframes');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'pulse-keyframes';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      @keyframes pulse-expand {
        0%   { transform: scale(1);         opacity: 0.65; }
        65%  { transform: scale(${scale});  opacity: 0.50; }
        100% { transform: scale(${scale});  opacity: 0;    }
      }
    `;
  }

  // ============================================================
  // MODO RADAR TOGGLE
  // ============================================================

  function toggleRadar() {
    // Button now only toggles heatmap layer
    toggleHeatmap();

    // Update chip appearance based on heatmap state
    if (calmZone) {
      calmZone.className = 'calm-zone ' + (heatmapVisible ? 'calm-zone--radar-on' : 'calm-zone--radar-off');
    }
  }

  // ============================================================
  // USER LOCATION TRACKING
  // ============================================================

  function setGpsStatus(status, accuracy) {
    // status: 'searching' | 'active' | 'error'
    gpsDot.className = 'gps-dot' + (status === 'active' ? ' active' : status === 'error' ? ' error' : '');
    if (status === 'searching') gpsLabel.textContent = t('map.gps_searching');
    else if (status === 'active') gpsLabel.textContent = t('map.gps_active', { m: Math.round(accuracy || 0) });
    else gpsLabel.textContent = t('map.gps_none');
  }

  const calmZone = document.getElementById('calm-zone');
  if (calmZone) calmZone.addEventListener('click', toggleRadar);

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
        loadSurgeBaseline();
        loadZoneInsights();
        subscribeToAlerts();
        // Init push notifications once on first GPS fix — pass position so
        // lat/lng is saved to push_subscriptions immediately for distance filtering
        if (!pushInitialized && window.initPush) {
          pushInitialized = true;
          window.initPush(USER_ID, userPosition);
        }
        // Also update any existing subscription with the current location
        updatePushLocation();
      }, 50);
    } else {
      if (userMarker) userMarker.setLatLng([lat, lng]);
      updateRadar();
      // Re-center map gently if user moved significantly
      if (map) {
        const mapCenter = map.getCenter();
        const moveDist = haversineDistance(mapCenter.lat, mapCenter.lng, lat, lng);
        if (moveDist > 30) {
          map.panTo([lat, lng], { animate: true, duration: 0.5 });
        }
      }
      // Debounced push location update — keeps stored lat/lng fresh as user moves
      // (30 s debounce avoids hammering Supabase on every GPS tick)
      clearTimeout(pushLocationUpdateTimeout);
      pushLocationUpdateTimeout = setTimeout(updatePushLocation, 30000);
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
    return `<div class="popup-card">
      <p class="popup-card-title">${t('map.popup_title')}</p>
      <p class="popup-card-meta">${ageStr}${verifiedHtml ? ' · ' : ''}${verified ? '<span style="color:#2e7d32;font-weight:700">' + t('map.verified', { n: corroborators + 1 }) + '</span>' : ''}</p>
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
      .bindPopup(buildPopupHtml(alert, false), { maxWidth: 220, minWidth: 140, closeButton: false })
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
        if (id === ownAlertTempId) { ownAlertTempId = null; ownAlertDbId = null; }
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
        { event: 'UPDATE', schema: 'public', table: 'alerts' },
        (payload) => {
          const alert = payload.new;
          // Remove cancelled alerts from map (broadcast to all clients)
          if (alert.cancelled) {
            removeAlertMarker(alert.id);
            updateBadgeAndPanel();
          }
        }
      )
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
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[Whistle] Realtime disconnected (' + status + '), reconnecting in 5s…');
          supabase.removeChannel(realtimeChannel);
          realtimeChannel = null;
          setTimeout(() => {
            if (!realtimeChannel && userPosition) subscribeToAlerts();
          }, 5000);
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

    const box    = getBoundingBox(userPosition.lat, userPosition.lng, HEATMAP_RADIUS_M);
    const cutoff = new Date(Date.now() - HEATMAP_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Run Supabase + Overpass in parallel — heatmap works even if Overpass fails
    const [alertResult, osmResult] = await Promise.allSettled([
      supabase
        .from('alerts')
        .select('lat, lng, created_at')
        .gte('lat', box.minLat).lte('lat', box.maxLat)
        .gte('lng', box.minLng).lte('lng', box.maxLng)
        .gte('created_at', cutoff)
        .limit(2000),
      fetchOsmHeatPoints(box),
    ]);

    const now         = Date.now();
    const currentHour = new Date().getHours();

    // Real Whistle alerts: combined recency × time-of-day weight
    //   recency:  1.0 (today) → 0.1 (30 days old), linear decay
    //   time-of-day: 1.0 (same hour) → 0.3 (≥6h different), linear decay
    //   → alerts that happened at THIS time of day are emphasised
    const alertPoints = (alertResult.status === 'fulfilled' && alertResult.value.data)
      ? alertResult.value.data.map(a => {
          const ageDays      = (now - new Date(a.created_at).getTime()) / 86400000;
          const recencyW     = Math.max(0.1, 1 - ageDays / HEATMAP_DAYS);
          const alertHour    = new Date(a.created_at).getHours();
          const hourDiff     = Math.min(Math.abs(alertHour - currentHour), 24 - Math.abs(alertHour - currentHour));
          const timeW        = Math.max(0.3, 1 - hourDiff / 6);
          return [a.lat, a.lng, recencyW * timeW];
        })
      : [];

    // OSM POI baseline: fixed weight OSM_POI_WEIGHT (0.2)
    // Real alerts dominate when present; POIs provide signal in cold-start areas
    const osmPoints = osmResult.status === 'fulfilled' ? osmResult.value : [];

    const allPoints = [...alertPoints, ...osmPoints];
    if (allPoints.length === 0) return;

    if (heatLayer) map.removeLayer(heatLayer);
    heatLayer = L.heatLayer(allPoints, {
      radius: 35,
      blur: 25,
      maxZoom: 17,
      gradient: { 0.4: '#2196F3', 0.65: '#FF9800', 1: '#F44336' },
    });

    heatmapLoaded = true;
    if (heatmapVisible) heatLayer.addTo(map);
  }

  /** Fetches OSM POIs and returns them as low-weight heatmap points [lat, lng, weight] */
  async function fetchOsmHeatPoints(box) {
    const { minLat: s, maxLat: n, minLng: w, maxLng: e } = box;
    const q = `[out:json][timeout:25];(
      node["public_transport"="station"]["name"](${s},${w},${n},${e});
      node["railway"="station"]["name"](${s},${w},${n},${e});
      node["railway"="subway_entrance"]["name"](${s},${w},${n},${e});
      node["tourism"="attraction"]["name"](${s},${w},${n},${e});
      node["tourism"="museum"]["name"](${s},${w},${n},${e});
      node["amenity"="marketplace"]["name"](${s},${w},${n},${e});
      node["shop"="mall"]["name"](${s},${w},${n},${e});
    );out 100;`;

    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
        });
        if (!res.ok) continue;
        const json = await res.json();
        if (json.remark && json.remark.includes('timed out')) continue;
        const points = (json.elements || [])
          .filter(el => el.lat && el.lon)
          .map(el => [el.lat, el.lon, OSM_POI_WEIGHT]);
        console.log(`[Whistle] OSM baseline: ${points.length} POIs → heatmap`);
        return points;
      } catch (e) {
        console.warn(`[Whistle] OSM baseline ${endpoint} failed:`, e.message);
      }
    }
    return []; // Overpass unavailable — heatmap still works with real alerts only
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
    } else {
      heatmapBtn.classList.remove('active');
      heatmapBtn.querySelector('#heatmap-btn-label').textContent = t('map.heatmap_on');
      riskLegend.classList.add('hidden');
      if (heatLayer) map.removeLayer(heatLayer);
    }
  }


  // ============================================================
  // BADGE & PANEL UPDATE
  // ============================================================

  let panelAutoHideTimer = null;

  /** Converts a millisecond duration to a short human-readable string (30m, 2h, 3d) */
  function formatAge(ms) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.round(ms / 3600000);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(ms / 86400000)}d`;
  }

  /** Shows the safe-zone panel (0 alerts) with zone history info */
  function showSafePanel() {
    const safeLastEl = document.getElementById('panel-safe-last');
    const panelOwnDetails = document.getElementById('panel-own-details');
    const panelIcon = document.getElementById('panel-icon');

    bottomPanel.classList.remove('bottom-panel--own', 'bottom-panel--warn');
    bottomPanel.classList.add('bottom-panel--safe');
    if (panelIcon) panelIcon.src = 'security_black.png';

    panelTitleText.textContent = t('map.panel_safe_title');
    panelSubtitle.textContent  = t('map.panel_safe_sub1');
    panelSubtitle.classList.remove('hidden');
    if (panelOwnDetails) panelOwnDetails.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');

    if (safeLastEl) {
      if (zoneLastAlertTime) {
        safeLastEl.textContent = t('map.panel_safe_last', { t: formatAge(Date.now() - zoneLastAlertTime) });
        safeLastEl.classList.remove('hidden');
      } else if (zoneInsightsReady) {
        safeLastEl.textContent = t('map.panel_safe_no_history');
        safeLastEl.classList.remove('hidden');
      } else {
        safeLastEl.classList.add('hidden');
      }
    }

    showPanel(10000);
  }

  function showPanel(durationMs = 10000) {
    bottomPanel.classList.add('visible');
    riskLegend.classList.add('panel-open');
    clearTimeout(panelAutoHideTimer);
    panelAutoHideTimer = setTimeout(hidePanel, durationMs);
  }

  function hidePanel() {
    bottomPanel.classList.remove('visible');
    riskLegend.classList.remove('panel-open');
    // Restore from own-alert state if active
    bottomPanel.classList.remove('bottom-panel--own');
    panelSubtitle.classList.remove('hidden');
    if (panelOwnDetails) panelOwnDetails.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    stopCountdown();
  }

  // ── Countdown helpers ─────────────────────────────────────────
  function stopCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── Foot-traffic estimate (proxy for people who could receive the alert) ──
  // Based on time-of-day + day-of-week + deterministic location variance.
  // Used until the app has enough real users to report actual push recipients.
  function estimateFootTraffic() {
    const hour = new Date().getHours();
    const day  = new Date().getDay();          // 0 = Sun, 6 = Sat
    const isWeekend = day === 0 || day === 6;

    // Base people within 100 m by time-of-day
    let base;
    if      (hour >= 8  && hour <= 9)  base = 85;  // morning rush
    else if (hour >= 13 && hour <= 14) base = 65;  // lunch rush
    else if (hour >= 18 && hour <= 20) base = 95;  // evening rush
    else if (hour >= 10 && hour <= 17) base = 45;  // normal daytime
    else if (hour >= 21 && hour <= 23) base = 28;  // late evening
    else                               base = 8;   // night (0 – 7h)

    if (isWeekend) base = Math.round(base * 0.75); // fewer commuters on weekends

    // Small deterministic variance keyed to location so the same spot is consistent
    if (userPosition) {
      const seed = Math.abs(Math.round(userPosition.lat * 1000 + userPosition.lng * 1000)) % 21;
      base += (seed - 10);   // ± 10 person variance
    }

    return Math.max(5, base);
  }

  function showOwnAlertPanel() {
    const panelIcon = document.getElementById('panel-icon');

    // Switch panel to own-alert style
    bottomPanel.classList.remove('bottom-panel--safe', 'bottom-panel--warn');
    bottomPanel.classList.add('bottom-panel--own');
    if (panelIcon) panelIcon.src = 'whistle2_black.png';

    // Title
    panelTitleText.textContent = t('map.own_panel_title');

    // Hide normal subtitle, show own-alert detail lines + cancel button
    panelSubtitle.classList.add('hidden');
    if (panelOwnDetails) panelOwnDetails.classList.remove('hidden');
    // if (cancelBtn) cancelBtn.classList.remove('hidden'); // disabled

    // Line 1: reach + foot-traffic estimate
    const estimated = estimateFootTraffic();
    if (panelOwnReach) panelOwnReach.textContent = t('map.own_panel_reach', { n: estimated });

    // Line 2: hidden (merged into reach line)
    if (panelOwnUsers) panelOwnUsers.classList.add('hidden');

    // Line 3: countdown — 20 minutes (matches alert active lifetime)
    stopCountdown();
    countdownEndTime = Date.now() + ALERT_AGE_MIN * 60 * 1000;

    const tick = () => {
      const remaining = countdownEndTime - Date.now();
      if (panelOwnCountdown) {
        panelOwnCountdown.textContent = t('map.own_panel_duration', { t: formatCountdown(remaining) });
      }
      if (remaining <= 0) stopCountdown();
    };
    tick();
    countdownInterval = setInterval(tick, 1000);

    // Show panel for 10s — own-alert panel is one-time only, not re-openable via badge
    showPanel(10000);
  }

  const riskBanner = document.getElementById('risk-banner');

  /** Fetches 30-day historical alert count for the immediate area at the current hour.
   *  Called once on first GPS fix. Result stored in historicalBaseline. */
  async function loadSurgeBaseline() {
    if (!userPosition) return;
    const box    = getBoundingBox(userPosition.lat, userPosition.lng, ALERT_RADIUS_M);
    const cutoff = new Date(Date.now() - HEATMAP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const currentHour = new Date().getHours();

    const { data } = await supabase
      .from('alerts')
      .select('created_at')
      .gte('lat', box.minLat).lte('lat', box.maxLat)
      .gte('lng', box.minLng).lte('lng', box.maxLng)
      .gte('created_at', cutoff);

    if (!data || data.length === 0) return;

    // Keep only alerts within ±1 hour of current time (handles midnight wrap)
    const sameHour = data.filter(a => {
      const h = new Date(a.created_at).getHours();
      return Math.min(Math.abs(h - currentHour), 24 - Math.abs(h - currentHour)) <= 1;
    });

    // Average per 30-min slot: total / 30 days / 2 slots per hour
    historicalBaseline = sameHour.length / (HEATMAP_DAYS * 2);
    console.log(`[Whistle] Surge baseline: ${sameHour.length} historical → avg ${historicalBaseline.toFixed(2)} alerts/30min`);
  }

  // ============================================================
  // ZONE INSIGHTS - Safety score, calm duration, peak hours
  // ============================================================

  /** Returns the calm-zone chip label with live duration suffix when data is ready */
  function buildCalmText() {
    if (!zoneInsightsReady) return t('map.calm_zone');
    if (zoneLastAlertTime === null) return t('zone.calm_long'); // ≥30 days calm
    const calmMin = Math.floor((Date.now() - zoneLastAlertTime) / 60000);
    if (calmMin < 60)   return t('zone.calm_min', { n: calmMin });
    if (calmMin < 1440) return t('zone.calm_h',   { n: Math.floor(calmMin / 60) });
    return t('zone.calm_d', { n: Math.floor(calmMin / 1440) });
  }

  /** Fetches 30-day historical data for the 100m zone and renders score + peak chips */
  async function loadZoneInsights() {
    if (!userPosition) return;

    const box    = getBoundingBox(userPosition.lat, userPosition.lng, ALERT_RADIUS_M);
    const cutoff = new Date(Date.now() - ZONE_INSIGHT_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('alerts')
      .select('lat, lng, created_at')
      .gte('lat', box.minLat).lte('lat', box.maxLat)
      .gte('lng', box.minLng).lte('lng', box.maxLng)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (!data) return;

    // Precise Haversine filter
    const nearby = data.filter(a =>
      haversineDistance(userPosition.lat, userPosition.lng, a.lat, a.lng) <= ALERT_RADIUS_M
    );

    // --- Safety score (last 7 days, recency-weighted 1.0→0) ---
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent7d = nearby.filter(a => new Date(a.created_at).getTime() >= sevenDaysAgo);
    const weightedSum = recent7d.reduce((sum, a) => {
      const ageDays = (Date.now() - new Date(a.created_at).getTime()) / 86400000;
      return sum + Math.max(0, 1 - ageDays / 7);
    }, 0);
    const score = Math.max(0, Math.round(100 - weightedSum * ZONE_SCORE_WEIGHT));

    // --- Last alert time (for calm-duration chip) ---
    zoneLastAlertTime = nearby.length > 0
      ? new Date(nearby[0].created_at).getTime()
      : null;

    // --- Peak hour (counts by hour-of-day across 30 days) ---
    const hourCounts = new Array(24).fill(0);
    nearby.forEach(a => { hourCounts[new Date(a.created_at).getHours()]++; });
    const maxCount = Math.max(...hourCounts);
    const peakHour = maxCount >= ZONE_PEAK_MIN_DATA ? hourCounts.indexOf(maxCount) : null;

    zoneInsightsReady = true;
    console.log(`[Whistle] Zone insights: score=${score}, peak=${peakHour}h, lastAlert=${zoneLastAlertTime ? new Date(zoneLastAlertTime).toLocaleTimeString() : 'none'}`);

    // --- Score chip and peak chip disabled ---
    if (zoneScoreChip) zoneScoreChip.className = 'zone-chip hidden';
    if (zonePeakChip)  zonePeakChip.className  = 'zone-chip hidden';
    if (zoneChips)     zoneChips.classList.add('hidden');

    // Refresh calm chip now that we have the last-alert timestamp
    updateBadgeAndPanel();
  }

  function updateRiskBanner() {
    const cutoff      = Date.now() - SURGE_WINDOW_MIN * 60 * 1000;
    const recentCount = Array.from(alertData.values())
      .filter(a => new Date(a.created_at).getTime() >= cutoff)
      .length;

    const surgeRatio = historicalBaseline > 0 ? recentCount / historicalBaseline : 0;
    const isSurge    = recentCount >= SURGE_MIN_COUNT && surgeRatio >= SURGE_THRESHOLD;

    if (isSurge) {
      riskBanner.textContent = t('map.risk_surge', { n: recentCount, x: Math.round(surgeRatio) });
      riskBanner.classList.remove('hidden', 'warn');
    } else if (recentCount >= 2) {
      riskBanner.textContent = t('map.risk_zone_high', { n: recentCount });
      riskBanner.classList.remove('hidden', 'warn');
    } else if (recentCount === 1) {
      riskBanner.textContent = t('map.risk_zone_low', { n: recentCount });
      riskBanner.classList.remove('hidden');
      riskBanner.classList.add('warn');
    } else {
      riskBanner.classList.add('hidden');
    }
  }

  function updateBadgeAndPanel() {
    const count = alertMarkers.size;
    updateRiskBanner();
    // Heatmap chip — visible once GPS is ready
    if (calmZone) {
      if (!userPosition) {
        calmZone.className = 'calm-zone hidden';
      } else {
        calmZone.className = 'calm-zone ' + (heatmapVisible ? 'calm-zone--radar-on' : 'calm-zone--radar-off');
        calmZone.innerHTML = '<svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      }
    }

    // Badge — always visible, colour adapts to alert count
    alertBadgeCount.textContent = count;
    alertBadgeCount.className = 'badge-count'
      + (count === 0 ? '' : count === 1 ? ' badge-count--warn' : ' badge-count--danger');

    // Notification panel
    if (count > 0) {
      const panelIcon = document.getElementById('panel-icon');
      document.getElementById('panel-safe-last')?.classList.add('hidden');
      panelSubtitle.classList.remove('hidden');
      if (panelOwnDetails) panelOwnDetails.classList.add('hidden');

      if (count <= 2) {
        // 1-2 alerts — amber "Carterista en la zona"
        bottomPanel.classList.remove('bottom-panel--safe', 'bottom-panel--own');
        bottomPanel.classList.add('bottom-panel--warn');
        if (panelIcon) panelIcon.src = 'thief2.png';
        panelTitleText.textContent = t('map.panel_title_one');
        panelSubtitle.textContent  = count === 1
          ? t('map.panel_sub_one')
          : t('map.panel_sub_many', { n: count });
      } else {
        // 3+ alerts — red "Actividad elevada"
        bottomPanel.classList.remove('bottom-panel--safe', 'bottom-panel--own', 'bottom-panel--warn');
        if (panelIcon) panelIcon.src = 'thief2.png';
        panelTitleText.textContent = t('map.panel_title_many');
        panelSubtitle.textContent  = t('map.panel_sub_many', { n: count });
      }
      showPanel();
    } else {
      // Show safe zone panel once zone insights are loaded
      if (zoneInsightsReady) {
        showSafePanel();
      } else {
        clearTimeout(panelAutoHideTimer);
        hidePanel();
      }
    }

    // Radar colour syncs with zone status
    updateRadar();
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
    ownAlertTempId = tempId;
    ownAlertDbId   = null;
    createAlertMarker(tempAlert);
    updateBadgeAndPanel();
    showOwnAlertPanel();
    vibrate([100]);

    // Start cooldown UI
    startCooldown();

    // Insert into Supabase — request the real row ID back for cancel support
    const { data: insertedData, error } = await supabase
      .from('alerts')
      .insert({
        lat: userPosition.lat,
        lng: userPosition.lng,
        user_id: USER_ID,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Whistle] sendAlert error:', error);
      ownAlertTempId = null;
      ownAlertDbId   = null;
      removeAlertMarker(tempId);
      updateBadgeAndPanel();
      showToast(t('map.send_error'));
    } else if (insertedData) {
      ownAlertDbId = insertedData.id;
    }
  }

  /**
   * updatePushLocation — writes the user's current lat/lng into push_subscriptions
   * so the Edge Function can apply the correct 100 m distance filter.
   * Called on first GPS fix and debounced on subsequent position changes.
   */
  async function updatePushLocation() {
    if (!userPosition || !USER_ID) return;
    try {
      await supabase
        .from('push_subscriptions')
        .update({
          lat: userPosition.lat,
          lng: userPosition.lng,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', USER_ID);
      console.log('[Whistle] Push location updated:', userPosition.lat, userPosition.lng);
    } catch (e) {
      console.warn('[Whistle] updatePushLocation failed:', e);
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
  // CANCEL OWN ALERT
  // ============================================================

  async function cancelOwnAlert() {
    const tempId = ownAlertTempId;
    const dbId   = ownAlertDbId;
    if (!tempId && !dbId) return;

    // Remove temp marker from map immediately
    if (tempId) removeAlertMarker(tempId);

    // Stop button cooldown
    clearInterval(cooldownInterval);
    cooldownInterval = null;
    isOnCooldown = false;
    alertBtn.classList.remove('cooldown');
    btnLabel.textContent = '';

    // Hide own-alert panel (also stops panel countdown via hidePanel)
    hidePanel();
    bottomPanel.classList.remove('bottom-panel--own');

    // Clear own-alert tracking state
    ownAlertTempId = null;
    ownAlertDbId   = null;

    updateBadgeAndPanel();
    showToast(t('map.cancel_success'));

    // Propagate cancellation to Supabase (other clients get UPDATE event)
    if (dbId) {
      const { error } = await supabase
        .from('alerts')
        .update({ cancelled: true })
        .eq('id', dbId)
        .eq('user_id', USER_ID);

      if (error) {
        console.error('[Whistle] cancelOwnAlert error:', error);
      }
    }
    // Note: if dbId is null (INSERT hasn't returned yet), the alert will expire
    // naturally after ALERT_AGE_MIN minutes; local marker is already removed.
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

    // Badge click → toggle panel visibility
    // Own-alert panel is one-time only (shown on send, never re-opened via badge)
    alertBadge.addEventListener('click', () => {
      if (bottomPanel.classList.contains('visible')) {
        hidePanel();
      } else {
        updateBadgeAndPanel();
      }
    });

    // Cancel alert button
    if (cancelBtn) cancelBtn.addEventListener('click', cancelOwnAlert);

    // My location button
    const myLocBtn = document.getElementById('my-location-btn');
    if (myLocBtn) myLocBtn.addEventListener('click', () => {
      if (map && userMarker) {
        map.flyTo(userMarker.getLatLng(), 18, { duration: 0.6 });
        myLocBtn.style.color = '#1a73e8';
        setTimeout(() => { myLocBtn.style.color = ''; }, 1000);
      }
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
