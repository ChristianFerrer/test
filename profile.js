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
      icon: '💨',
      name: 'Primer Silbato',
      desc: 'Envía tu primera alerta',
      check: function (s) { return { earned: s.total >= 1, current: s.total, goal: 1 }; },
    },
    {
      id: 'night_watch',
      icon: '🌙',
      name: 'Vigía Nocturno',
      desc: 'Alerta enviada entre 00:00 y 06:00',
      check: function (s) { return { earned: s.nightAlerts >= 1, current: s.nightAlerts, goal: 1 }; },
    },
    {
      id: 'verified',
      icon: '✅',
      name: 'Verificador',
      desc: 'Tu alerta fue corroborada por otros',
      check: function (s) { return { earned: s.verifiedCount >= 1, current: s.verifiedCount, goal: 1 }; },
    },
    {
      id: 'streak_7',
      icon: '🔥',
      name: 'Racha de 7',
      desc: '7 días consecutivos reportando',
      check: function (s) { return { earned: s.streak >= 7, current: s.streak, goal: 7 }; },
    },
    {
      id: 'zone_guardian',
      icon: '🛡️',
      name: 'Guardián',
      desc: '10 alertas en una misma zona',
      check: function (s) { return { earned: s.maxZoneAlerts >= 10, current: s.maxZoneAlerts, goal: 10 }; },
    },
    {
      id: 'sentinel',
      icon: '🎯',
      name: 'Centinela',
      desc: '50 alertas enviadas en total',
      check: function (s) { return { earned: s.total >= 50, current: s.total, goal: 50 }; },
    },
    {
      id: 'protector',
      icon: '👥',
      name: 'Protector',
      desc: 'Avisaste a más de 100 personas',
      check: function (s) { return { earned: s.reach >= 100, current: s.reach, goal: 100 }; },
    },
    {
      id: 'early_bird',
      icon: '🌅',
      name: 'Madrugador',
      desc: 'Alerta enviada entre 06:00 y 09:00',
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

      return '<div class="badge-item ' + (isEarned ? 'earned' : 'locked') + '" title="' + b.desc + '">'
        + '<div class="badge-icon">' + b.icon + '</div>'
        + '<div class="badge-name">' + b.name + '</div>'
        + progressHtml
        + '</div>';
    }).join('');

    grid.innerHTML = html;
    if (counter) counter.textContent = earnedCount + '/' + BADGES.length;

    // Save earned state
    var earned = {};
    BADGES.forEach(function (b) { if (b.check(stats).earned) earned[b.id] = true; });
    try { localStorage.setItem('whistle_badges', JSON.stringify(earned)); } catch (e) {}

    // Celebrate newly earned badges
    if (newlyEarned.length > 0) {
      var delay = 500;
      newlyEarned.forEach(function (b, i) {
        setTimeout(function () {
          showToast(b.icon + ' ' + b.name + ' desbloqueado!');
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
