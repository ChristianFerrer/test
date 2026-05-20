// ============================================================
// profile.js - Profile screen logic
// ============================================================

(function () {
  'use strict';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --- DOM ---
  const profileAvatar  = document.getElementById('profile-avatar');
  const profileEmail   = document.getElementById('profile-email');
  const profileSince   = document.getElementById('profile-since');
  const statTotal      = document.getElementById('stat-total');
  const statToday      = document.getElementById('stat-today');
  const statStreak     = document.getElementById('stat-streak');
  const statReach      = document.getElementById('stat-reach');
  const myAlertsList   = document.getElementById('my-alerts-list');
  const btnLogout      = document.getElementById('btn-logout');

  document.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('flipped');
    });
  });

  // ============================================================
  // BADGES DEFINITION
  // ============================================================

  const BADGES = [
    {
      id: 'first_whistle',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>',
      name: 'Primer Silbato',
      desc: 'Envía tu primera alerta para desbloquear este logro',
      check: function (s) { return { earned: s.total >= 1, current: s.total, goal: 1 }; },
    },
    {
      id: 'night_watch',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
      name: 'Vigía Nocturno',
      desc: 'Envía una alerta entre las 00:00 y las 06:00',
      check: function (s) { return { earned: s.nightAlerts >= 1, current: s.nightAlerts, goal: 1 }; },
    },
    {
      id: 'verified',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      name: 'Verificador',
      desc: 'Otro usuario corroboró tu alerta reportando en el mismo lugar y momento',
      check: function (s) { return { earned: s.verifiedCount >= 1, current: s.verifiedCount, goal: 1 }; },
    },
    {
      id: 'streak_7',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      name: 'Racha de 7',
      desc: 'Reporta alertas durante 7 días consecutivos sin parar',
      check: function (s) { return { earned: s.streak >= 7, current: s.streak, goal: 7 }; },
    },
    {
      id: 'zone_guardian',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      name: 'Guardián',
      desc: 'Envía 10 o más alertas en la misma zona de ~500m',
      check: function (s) { return { earned: s.maxZoneAlerts >= 10, current: s.maxZoneAlerts, goal: 10 }; },
    },
    {
      id: 'sentinel',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
      name: 'Centinela',
      desc: 'Alcanza las 50 alertas enviadas en total',
      check: function (s) { return { earned: s.total >= 50, current: s.total, goal: 50 }; },
    },
    {
      id: 'protector',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
      name: 'Protector',
      desc: 'Tus alertas han avisado a más de 100 personas en total',
      check: function (s) { return { earned: s.reach >= 100, current: s.reach, goal: 100 }; },
    },
    {
      id: 'early_bird',
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
      name: 'Madrugador',
      desc: 'Envía una alerta entre las 06:00 y las 09:00',
      check: function (s) { return { earned: s.earlyAlerts >= 1, current: s.earlyAlerts, goal: 1 }; },
    },
  ];

  function computeBadgeStats(alerts, streak, reach, othersAlerts) {
    const nightAlerts = alerts.filter(function (a) { var h = new Date(a.created_at).getHours(); return h >= 0 && h < 6; }).length;
    const earlyAlerts = alerts.filter(function (a) { var h = new Date(a.created_at).getHours(); return h >= 6 && h < 9; }).length;

    var zoneCounts = {};
    alerts.forEach(function (a) {
      var key = (Math.round(a.lat * 200) / 200) + ',' + (Math.round(a.lng * 200) / 200);
      zoneCounts[key] = (zoneCounts[key] || 0) + 1;
    });
    var maxZoneAlerts = 0;
    Object.keys(zoneCounts).forEach(function (k) {
      if (zoneCounts[k] > maxZoneAlerts) maxZoneAlerts = zoneCounts[k];
    });

    var verifiedCount = 0;
    alerts.forEach(function (a) {
      var aTime = new Date(a.created_at).getTime();
      for (var i = 0; i < othersAlerts.length; i++) {
        var b = othersAlerts[i];
        var timeDiff = Math.abs(aTime - new Date(b.created_at).getTime()) / 60000;
        if (timeDiff <= CLUSTER_TIME_MIN && haversineDistance(a.lat, a.lng, b.lat, b.lng) <= CLUSTER_RADIUS_M) {
          verifiedCount++;
          break;
        }
      }
    });

    return {
      total: alerts.length,
      nightAlerts: nightAlerts,
      earlyAlerts: earlyAlerts,
      streak: streak,
      reach: reach,
      maxZoneAlerts: maxZoneAlerts,
      verifiedCount: verifiedCount,
    };
  }

  function renderBadges(stats) {
    var grid = document.getElementById('badges-grid');
    var counter = document.getElementById('badge-counter');
    if (!grid) return;

    var earnedCount = 0;
    var previouslyEarned = {};
    try { previouslyEarned = JSON.parse(localStorage.getItem('whistle_badges') || '{}'); } catch (e) {}
    var newlyEarned = [];

    var html = BADGES.map(function (b) {
      var result = b.check(stats);
      var isEarned = result.earned;
      if (isEarned) earnedCount++;
      if (isEarned && !previouslyEarned[b.id]) newlyEarned.push(b);

      var progressHtml = '';
      if (!isEarned && result.goal > 1) {
        var pct = Math.min(100, Math.round((result.current / result.goal) * 100));
        progressHtml = '<div class="badge-progress">' + result.current + '/' + result.goal + '</div>'
          + '<div class="badge-progress-bar"><div class="badge-progress-fill" style="width:' + pct + '%"></div></div>';
      }

      return '<div class="badge-item ' + (isEarned ? 'earned' : 'locked') + '">'
        + '<div class="badge-item-inner">'
        +   '<div class="badge-front">'
        +     '<div class="badge-icon">' + b.icon + '</div>'
        +     '<div class="badge-name">' + b.name + '</div>'
        +     progressHtml
        +   '</div>'
        +   '<div class="badge-back">'
        +     '<div class="badge-back-title">' + b.name + '</div>'
        +     '<div class="badge-back-desc">' + b.desc + '</div>'
        +   '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    grid.innerHTML = html;
    if (counter) counter.textContent = earnedCount + '/' + BADGES.length;

    grid.querySelectorAll('.badge-item').forEach(function (card) {
      card.addEventListener('click', function () { card.classList.toggle('flipped'); });
    });

    // Save earned state
    var earned = {};
    BADGES.forEach(function (b) { if (b.check(stats).earned) earned[b.id] = true; });
    try { localStorage.setItem('whistle_badges', JSON.stringify(earned)); } catch (e) {}

    // Celebrate newly earned badges
    if (newlyEarned.length > 0) {
      var delay = 500;
      newlyEarned.forEach(function (b, i) {
        setTimeout(function () {
          showToast(b.name + ' desbloqueado!');
          if (typeof vibrate === 'function') vibrate(50);
        }, delay + i * 1500);
      });
    }
  }

  // ============================================================
  // BOOT — check session first
  // ============================================================

  async function boot() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = 'login.html';
      return;
    }

    renderUserInfo(session.user);
    await loadMyAlerts(session.user.id);
  }

  // ============================================================
  // USER INFO
  // ============================================================

  function renderUserInfo(user) {
    const email = user.email || t('profile.anonymous');
    const initial = email.charAt(0).toUpperCase();
    const createdAt = new Date(user.created_at);
    const locale = window.appLang === 'en' ? 'en-US' : 'es-ES';

    profileAvatar.textContent = initial;
    profileEmail.textContent  = email;
    profileSince.textContent  = t('profile.since') + createdAt.toLocaleDateString(locale, {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  // ============================================================
  // MY ALERTS
  // ============================================================

  async function loadMyAlerts(userId) {
    const [myResult, allResult] = await Promise.all([
      supabase.from('alerts').select('id, lat, lng, created_at, user_id')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
      supabase.from('alerts').select('id, lat, lng, created_at, user_id')
        .neq('user_id', userId).order('created_at', { ascending: false }).limit(500),
    ]);

    const data = myResult.data;
    const error = myResult.error;
    const othersAlerts = allResult.data || [];

    if (error) {
      myAlertsList.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><p>${t('profile.error')}</p></div>`;
      return;
    }

    // --- Stats ---
    const total = data.length;
    const todayStart = getTodayStart();
    const todayCount = data.filter(a => a.created_at >= todayStart).length;

    // Streak: consecutive calendar days (including today) going backwards
    function computeStreak(alerts) {
      if (!alerts.length) return 0;
      // Build a Set of 'YYYY-M-D' keys in local time
      const daySet = new Set(
        alerts.map(a => {
          const d = new Date(a.created_at);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        })
      );
      const today = new Date();
      // Walk back day by day from today until a gap is found
      let streak = 0;
      const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      while (daySet.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
      return streak;
    }

    // Reach estimate: each alert is seen by ~10 nearby users on average
    const AVG_REACH_PER_ALERT = 10;
    const reach = total * AVG_REACH_PER_ALERT;

    const streak = computeStreak(data);
    statTotal.textContent  = total;
    statToday.textContent  = todayCount;
    statStreak.textContent = streak;
    if (statReach) statReach.textContent = reach > 0 ? reach : '–';

    // --- Badges ---
    const badgeStats = computeBadgeStats(data, streak, reach, othersAlerts);
    renderBadges(badgeStats);

    // --- List ---
    if (total === 0) {
      myAlertsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
          <p>${t('profile.no_alerts')}</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">${t('profile.no_alerts_sub')}</p>
        </div>`;
      return;
    }

    const displayAlerts = data.slice(0, 50);
    myAlertsList.innerHTML = displayAlerts.map((alert, idx) => {
      const alertNum = total - idx;
      const d = new Date(alert.created_at);
      const locale = window.appLang === 'en' ? 'en-US' : 'es-ES';
      const dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
      const cardId  = `my-addr-${alert.id}`;
      const ageMin  = (Date.now() - d.getTime()) / 60000;
      const isRecent = ageMin < 5;

      reverseGeocode(alert.lat, alert.lng).then(address => {
        const el = document.getElementById(cardId);
        if (el) el.textContent = address || `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`;
      });

      return `
        <div class="alert-card${isRecent ? ' alert-card--recent' : ''}">
          <div class="alert-number">${alertNum}</div>
          <div class="card-body">
            <div class="card-top-row">
              <span class="card-datetime">${dateStr} · ${timeStr}</span>
              <span class="card-ago${isRecent ? ' card-ago--recent' : ''}">${formatTimeAgo(alert.created_at)}</span>
            </div>
            <div class="card-address-row">
              <span class="card-address" id="${cardId}">${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ============================================================
  // REVERSE GEOCODING (same as history.js)
  // ============================================================

  const geocodeCache = new Map();

  async function reverseGeocode(lat, lng) {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`,
        { headers: { 'Accept-Language': 'es' } }
      );
      if (!res.ok) throw new Error();
      const json = await res.json();
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
  // LOGOUT
  // ============================================================

  btnLogout.addEventListener('click', async () => {
    btnLogout.disabled = true;
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  // ============================================================
  // SHARE WHISTLE
  // ============================================================

  const btnShareWhistle = document.getElementById('btn-share-whistle');
  if (btnShareWhistle) {
    btnShareWhistle.addEventListener('click', () => {
      window.location.href = 'share.html';
    });
  }

  // ============================================================
  // START
  // ============================================================

  boot();

})();
