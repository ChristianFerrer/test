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
  const myAlertsList   = document.getElementById('my-alerts-list');
  const myAlertsBadge  = document.getElementById('my-alerts-badge');
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
    const email = user.email || 'Usuario anónimo';
    const initial = email.charAt(0).toUpperCase();
    const createdAt = new Date(user.created_at);

    profileAvatar.textContent = initial;
    profileEmail.textContent  = email;
    profileSince.textContent  = 'Miembro desde ' + createdAt.toLocaleDateString('es-ES', {
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
      myAlertsList.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Error al cargar tus alertas</p></div>`;
      return;
    }

    // --- Stats ---
    const total = data.length;
    const todayStart = getTodayStart();
    const todayCount = data.filter(a => a.created_at >= todayStart).length;

    // Active days: count distinct dates
    const distinctDays = new Set(
      data.map(a => new Date(a.created_at).toDateString())
    ).size;

    statTotal.textContent  = total;
    statToday.textContent  = todayCount;
    statStreak.textContent = distinctDays;

    if (total > 0) {
      myAlertsBadge.textContent = total;
      myAlertsBadge.style.display = 'inline-block';
    }

    // --- List ---
    if (total === 0) {
      myAlertsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>Aún no has enviado ninguna alerta</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">Usa el botón REPORTAR en el mapa para avisar a otros usuarios</p>
        </div>`;
      return;
    }

    myAlertsList.innerHTML = data.map(alert => {
      const d = new Date(alert.created_at);
      const dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
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
          <div class="card-main">
            <span class="card-datetime">${dateStr} · ${timeStr}</span>
            <span class="card-distance" style="color:var(--brand-black);font-size:13px">Tú</span>
          </div>
          <div class="card-secondary">
            <span class="card-address" id="${cardId}">${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}</span>
            <span class="card-ago${isRecent ? ' card-ago--recent' : ''}">${formatTimeAgo(alert.created_at)}</span>
          </div>
          <img src="whistle.png" class="card-icon" alt="" style="width:36px;height:36px;object-fit:contain;opacity:0.75;flex-shrink:0;">
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
