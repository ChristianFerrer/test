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
    const { data, error } = await supabase
      .from('alerts')
      .select('id, lat, lng, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

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

    statTotal.textContent  = total;
    statToday.textContent  = todayCount;
    statStreak.textContent = computeStreak(data);
    if (statReach) statReach.textContent = reach > 0 ? reach : '–';

    // --- Impact share card: only when user has sent at least 1 alert ---
    const impactCard  = document.getElementById('impact-card');
    const impactTitle = document.getElementById('impact-card-title');
    const impactSub   = document.getElementById('impact-card-sub');
    const btnShareImpact = document.getElementById('btn-share-impact');
    if (impactCard) {
      if (total > 0) {
        impactCard.classList.remove('hidden');
        impactTitle.textContent = t('profile.impact_title', { n: reach });
        impactSub.textContent   = t('profile.impact_sub',   { n: total });
        if (btnShareImpact) {
          btnShareImpact.onclick = () => {
            const msg = t('share.msg_impact', { n: total, r: reach });
            shareWhistle(msg, 'Whistle');
          };
        }
      } else {
        impactCard.classList.add('hidden');
      }
    }


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

    myAlertsList.innerHTML = data.map(alert => {
      const d = new Date(alert.created_at);
      const locale = window.appLang === 'en' ? 'en-US' : 'es-ES';
      const dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
      const cardId  = `my-addr-${alert.id}`;
      const ageMin  = (Date.now() - d.getTime()) / 60000;
      const isRecent = ageMin < 5;

      // Async geocode
      reverseGeocode(alert.lat, alert.lng).then(address => {
        const el = document.getElementById(cardId);
        if (el) el.textContent = address || `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`;
      });

      return `
        <div class="alert-card${isRecent ? ' alert-card--recent' : ''}">
          <img src="whistle.png" class="card-icon" alt="" style="width:36px;height:36px;object-fit:contain;opacity:0.75;flex-shrink:0;">
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
  // START
  // ============================================================

  boot();

})();
