// ============================================================
// admin.js - Admin Dashboard Logic
// ============================================================

(function () {
  'use strict';

  const ADMIN_EMAIL      = 'christianferbol@gmail.com';
  const EDGE_FUNC_URL    = `${SUPABASE_URL}/functions/v1/admin-stats`;
  const PAGE_SIZE        = 20;
  const ALERTS_PAGE_SIZE = 20;
  const NOMINATIM_DELAY  = 1100;

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── DOM refs ─────────────────────────────────────────────
  const loading          = document.getElementById('admin-loading');
  const dashboard        = document.getElementById('admin-dashboard');
  const btnLogout        = document.getElementById('btn-logout');
  const userSearch       = document.getElementById('user-search');
  const usersTbody       = document.getElementById('users-tbody');
  const pagination       = document.getElementById('table-pagination');
  const alertsTbody      = document.getElementById('alerts-tbody');
  const alertsPagination = document.getElementById('alerts-pagination');

  const fEmail         = document.getElementById('f-email');
  const fDateFrom      = document.getElementById('f-date-from');
  const fDateTo        = document.getElementById('f-date-to');
  const fTimeFrom      = document.getElementById('f-time-from');
  const fTimeTo        = document.getElementById('f-time-to');
  const fAddress       = document.getElementById('f-address');
  const btnClearFilters = document.getElementById('btn-clear-filters');

  const chkSelectAll   = document.getElementById('chk-select-all');
  const selectedCount  = document.getElementById('selected-count');
  const btnDeleteBulk  = document.getElementById('btn-delete-bulk');

  // ── State ─────────────────────────────────────────────────
  let allUsers       = [];
  let filtered       = [];
  let currentPage    = 1;
  let sortCol        = 'alerts';
  let sortDir        = -1;

  let allAlerts      = [];
  let filteredAlerts = [];
  let alertsPage     = 1;

  const selectedIds  = new Set();
  const addressCache = {};
  let geocodeQueue   = [];
  let geocoding      = false;

  // ── Boot ─────────────────────────────────────────────────
  async function boot() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }
    if (session.user.email !== ADMIN_EMAIL) { window.location.href = 'index.html'; return; }

    try {
      const res = await fetch(EDGE_FUNC_URL, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      renderDashboard(data);
    } catch (err) {
      loading.innerHTML = `<div class="empty-state"><p>Error al cargar: ${err.message}</p></div>`;
    }
  }

  // ── Render all sections ───────────────────────────────────
  function renderDashboard(data) {
    // Defaults for backward compat with old edge function
    data.growth     = data.growth     || { new_today:0, new_7d:0, new_30d:0, new_prev_7d:0, new_prev_30d:0, user_curve:{}, reg_email:0, reg_google:0, reg_other:0 };
    data.engagement = data.engagement || { dau:0, wau:0, mau:0, stickiness:0, alerts_per_user:0, active_users:0, dormant_users:0, active_rate:0, retention_rate:0 };
    data.temporal   = data.temporal   || { alerts_by_day: data.alerts_by_day || {}, alerts_by_hour: new Array(24).fill(0), weekday_alerts:0, weekend_alerts:0 };
    data.geographic = data.geographic || { unique_zones:0, top_zones:[] };
    data.kpi        = data.kpi        || {};
    data.kpi.push_adoption  = data.kpi.push_adoption  ?? 0;
    data.kpi.alerts_prev_7d = data.kpi.alerts_prev_7d ?? 0;
    data.kpi.alerts_prev_30d = data.kpi.alerts_prev_30d ?? 0;

    renderMainKPIs(data);
    renderGrowth(data.growth, data.kpi);
    renderEngagement(data.engagement, data.temporal);
    renderCoverage(data.temporal, data.geographic);
    renderTop5(data.top5_reporters || []);

    allUsers = data.users;
    filtered = [...allUsers];
    renderTable();

    allAlerts = data.alerts_list || [];
    applyFilters();
    wireFilters();

    loading.classList.add('hidden');
    dashboard.classList.remove('hidden');
  }

  // ══════════════════════════════════════════════════════════
  // MAIN KPIs
  // ══════════════════════════════════════════════════════════

  function renderMainKPIs(data) {
    const kpi = data.kpi || {};
    const growth = data.growth || {};
    const engagement = data.engagement || {};

    document.getElementById('kpi-users').textContent = kpi.total_users ?? '—';
    document.getElementById('kpi-mau').textContent = engagement.mau ?? 0;
    document.getElementById('kpi-alerts30').textContent = kpi.alerts_30d ?? '—';
    document.getElementById('kpi-push').textContent = kpi.push_subs ?? '—';

    setTrend('kpi-users-trend', growth.new_7d || 0, `+${growth.new_7d || 0} esta semana`);
    setTrend('kpi-mau-trend', engagement.active_rate || 0, `${engagement.active_rate || 0}% del total`);
    setTrend('kpi-alerts30-trend', trendPct(kpi.alerts_30d || 0, kpi.alerts_prev_30d || 0));
    setTrend('kpi-push-trend', kpi.push_adoption || 0, `${kpi.push_adoption || 0}% adopción`);
  }

  function trendPct(current, previous) {
    if (!previous) return current > 0 ? '+100%' : '0%';
    const pct = Math.round(((current - previous) / previous) * 100);
    return (pct >= 0 ? '+' : '') + pct + '% vs anterior';
  }

  function setTrend(id, value, text) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof value === 'string') {
      el.textContent = value;
      el.className = 'kpi-trend ' + (value.startsWith('-') ? 'trend-down' : 'trend-up');
    } else if (typeof text === 'string') {
      el.textContent = text;
      el.className = 'kpi-trend trend-up';
    } else {
      el.textContent = String(value);
      el.className = 'kpi-trend trend-neutral';
    }
  }

  // ══════════════════════════════════════════════════════════
  // GROWTH
  // ══════════════════════════════════════════════════════════

  function renderGrowth(growth, kpi) {
    document.getElementById('growth-today').textContent = growth.new_today;
    document.getElementById('growth-7d').textContent = growth.new_7d;
    document.getElementById('growth-30d').textContent = growth.new_30d;

    const t7 = trendPct(growth.new_7d, growth.new_prev_7d);
    const t30 = trendPct(growth.new_30d, growth.new_prev_30d);
    setTrendMini('growth-7d-trend', t7);
    setTrendMini('growth-30d-trend', t30);

    renderUserGrowthChart(growth.user_curve);
    renderRegDonut(growth);
  }

  function setTrendMini(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'metric-mini-trend ' + (text.startsWith('-') ? 'trend-down' : 'trend-up');
  }

  function renderUserGrowthChart(curve) {
    const wrap = document.getElementById('user-growth-chart');
    const entries = Object.entries(curve);
    if (!entries.length) { wrap.innerHTML = '<p>Sin datos</p>'; return; }

    const values = entries.map(e => e[1]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const width = 100;
    const height = 60;
    const points = entries.map(([_, v], i) => {
      const x = (i / (entries.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 10);
      return `${x},${y}`;
    });

    const polyline = points.join(' ');
    const areaPoints = `0,${height} ${polyline} ${width},${height}`;

    wrap.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="line-chart-svg">
        <polygon points="${areaPoints}" fill="rgba(245,197,24,0.15)"/>
        <polyline points="${polyline}" fill="none" stroke="#f5c518" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="line-chart-labels">
        <span>${entries[0][0].slice(5)}</span>
        <span>${entries[entries.length-1][0].slice(5)}</span>
      </div>
      <div class="line-chart-value">${max} usuarios</div>`;
  }

  function renderRegDonut(growth) {
    const total = growth.reg_email + growth.reg_google + growth.reg_other;
    if (!total) return;

    const pctEmail  = Math.round((growth.reg_email / total) * 100);
    const pctGoogle = Math.round((growth.reg_google / total) * 100);
    const pctOther  = 100 - pctEmail - pctGoogle;

    const donut = document.getElementById('reg-donut');
    const degEmail  = (pctEmail / 100) * 360;
    const degGoogle = (pctGoogle / 100) * 360;

    donut.innerHTML = `
      <div class="donut-ring" style="background: conic-gradient(
        #f5c518 0deg ${degEmail}deg,
        #4285f4 ${degEmail}deg ${degEmail + degGoogle}deg,
        #e0e0e0 ${degEmail + degGoogle}deg 360deg
      )"><div class="donut-hole">${total}</div></div>`;

    document.getElementById('reg-legend').innerHTML = `
      <div class="donut-legend-item"><span class="dot" style="background:#f5c518"></span>Email ${pctEmail}%</div>
      <div class="donut-legend-item"><span class="dot" style="background:#4285f4"></span>Google ${pctGoogle}%</div>
      ${pctOther > 0 ? `<div class="donut-legend-item"><span class="dot" style="background:#e0e0e0"></span>Otro ${pctOther}%</div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // ENGAGEMENT
  // ══════════════════════════════════════════════════════════

  function renderEngagement(eng, temporal) {
    document.getElementById('eng-dau').textContent = eng.dau;
    document.getElementById('eng-wau').textContent = eng.wau;
    document.getElementById('eng-mau').textContent = eng.mau;
    document.getElementById('eng-stickiness').textContent = eng.stickiness + '%';
    document.getElementById('eng-avg').textContent = eng.alerts_per_user;
    document.getElementById('eng-retention').textContent = eng.retention_rate + '%';

    // Active vs dormant bar
    const fill = document.getElementById('active-bar-fill');
    fill.style.width = eng.active_rate + '%';
    document.getElementById('active-bar-legend').innerHTML = `
      <span><span class="dot" style="background:#f5c518"></span>Activos: ${eng.active_users} (${eng.active_rate}%)</span>
      <span><span class="dot" style="background:#e0e0e0"></span>Dormidos: ${eng.dormant_users}</span>`;

    // 30-day alerts chart
    renderBarChart('chart-30d', temporal.alerts_by_day, 30);
  }

  // ══════════════════════════════════════════════════════════
  // COVERAGE & TEMPORAL
  // ══════════════════════════════════════════════════════════

  function renderCoverage(temporal, geographic) {
    document.getElementById('geo-zones').textContent = geographic.unique_zones;
    document.getElementById('geo-weekday').textContent = temporal.weekday_alerts;
    document.getElementById('geo-weekend').textContent = temporal.weekend_alerts;

    renderHourlyChart(temporal.alerts_by_hour);
    renderTopZones(geographic.top_zones);
  }

  function renderHourlyChart(hours) {
    const wrap = document.getElementById('chart-hours');
    const max = Math.max(...hours, 1);

    wrap.innerHTML = hours.map((count, h) => {
      const pct = Math.round((count / max) * 100);
      const label = String(h).padStart(2, '0');
      return `
        <div class="chart-bar-wrap chart-bar-wrap--sm">
          <div class="chart-bar-track">
            <div class="chart-bar" style="height:${pct}%" title="${count} alertas"></div>
          </div>
          <div class="chart-label">${label}</div>
        </div>`;
    }).join('');
  }

  function renderTopZones(zones) {
    const list = document.getElementById('top-zones-list');
    if (!zones.length) { list.innerHTML = '<p class="text-muted">Sin datos</p>'; return; }

    const max = zones[0].count;
    list.innerHTML = zones.map((z, i) => {
      const pct = Math.round((z.count / max) * 100);
      return `
        <div class="zone-row">
          <span class="zone-num">${i + 1}</span>
          <span class="zone-coord">${z.lat.toFixed(3)}, ${z.lng.toFixed(3)}</span>
          <div class="zone-bar-track"><div class="zone-bar" style="width:${pct}%"></div></div>
          <span class="zone-count">${z.count}</span>
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // SHARED BAR CHART
  // ══════════════════════════════════════════════════════════

  function renderBarChart(containerId, alertsByDay, days) {
    const wrap = document.getElementById(containerId);
    const entries = Object.entries(alertsByDay);
    const max = Math.max(...entries.map(e => e[1]), 1);

    wrap.innerHTML = entries.map(([date, count], i) => {
      const pct = Math.round((count / max) * 100);
      const showLabel = days <= 7 || i % 5 === 0 || i === entries.length - 1;
      const label = showLabel
        ? new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
        : '';
      return `
        <div class="chart-bar-wrap ${days > 7 ? 'chart-bar-wrap--sm' : ''}">
          <div class="chart-bar-track">
            <div class="chart-bar" style="height:${pct}%" title="${date}: ${count}"></div>
          </div>
          ${label ? `<div class="chart-label">${label}</div>` : '<div class="chart-label"></div>'}
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // TOP 5 REPORTERS
  // ══════════════════════════════════════════════════════════

  function renderTop5(top5) {
    const list = document.getElementById('top-list');
    if (!top5.length) {
      list.innerHTML = '<p class="text-muted">Sin datos</p>';
      return;
    }
    const maxCount = top5[0].count;
    list.innerHTML = top5.map((r, i) => {
      const pct = Math.round((r.count / maxCount) * 100);
      return `
        <div class="top-row">
          <span class="top-medal"><span class="top-medal-num">${i + 1}</span></span>
          <span class="top-email">${escHtml(r.email)}</span>
          <div class="top-bar-track"><div class="top-bar" style="width:${pct}%"></div></div>
          <span class="top-count">${r.count}</span>
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // ALERTS TABLE (unchanged logic)
  // ══════════════════════════════════════════════════════════

  function applyFilters() {
    const qEmail   = fEmail.value.trim().toLowerCase();
    const qAddr    = fAddress.value.trim().toLowerCase();
    const dateFrom = fDateFrom.value;
    const dateTo   = fDateTo.value;
    const timeFrom = fTimeFrom.value;
    const timeTo   = fTimeTo.value;

    filteredAlerts = allAlerts.filter(a => {
      const dt      = new Date(a.created_at);
      const dateStr = dt.toISOString().slice(0, 10);
      const timeStr = dt.toTimeString().slice(0, 5);

      if (qEmail   && !a.email.toLowerCase().includes(qEmail)) return false;
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo   && dateStr > dateTo)   return false;
      if (timeFrom && timeStr < timeFrom) return false;
      if (timeTo   && timeStr > timeTo)   return false;
      if (qAddr) {
        const cached = (addressCache[a.id] || '').toLowerCase();
        if (!cached.includes(qAddr)) return false;
      }
      return true;
    });

    alertsPage = 1;
    selectedIds.clear();
    updateActionBar();
    renderAlertsTable();
  }

  function renderAlertsTable() {
    const start = (alertsPage - 1) * ALERTS_PAGE_SIZE;
    const page  = filteredAlerts.slice(start, start + ALERTS_PAGE_SIZE);

    if (!page.length) {
      alertsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Sin alertas</td></tr>`;
      alertsPagination.innerHTML = '';
      updateActionBar();
      return;
    }

    alertsTbody.innerHTML = page.map(a => {
      const dt      = new Date(a.created_at);
      const fecha   = dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const hora    = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const lat     = parseFloat(a.lat).toFixed(5);
      const lng     = parseFloat(a.lng).toFixed(5);
      const mapUrl  = `https://www.google.com/maps?q=${a.lat},${a.lng}`;
      const addr    = addressCache[a.id] || '<span class="addr-loading">…</span>';
      const checked = selectedIds.has(a.id) ? 'checked' : '';
      const rowCls  = selectedIds.has(a.id) ? 'row-selected' : '';
      return `
        <tr class="${rowCls}" data-id="${a.id}">
          <td class="td-check"><input type="checkbox" class="row-chk" data-id="${a.id}" ${checked}></td>
          <td class="td-email">${escHtml(a.email)}</td>
          <td class="td-center td-date">${fecha} ${hora}</td>
          <td class="td-center td-coord">${lat}, ${lng}</td>
          <td class="td-addr" id="addr-${a.id}">${addr}</td>
          <td class="td-center td-map"><a class="map-link" href="${mapUrl}" target="_blank" rel="noopener"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> Ver</a></td>
          <td class="td-center"><button class="btn-del-row" data-id="${a.id}" title="Eliminar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>
        </tr>`;
    }).join('');

    alertsTbody.querySelectorAll('.row-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
        chk.closest('tr').classList.toggle('row-selected', chk.checked);
        syncSelectAll(page);
        updateActionBar();
      });
    });

    alertsTbody.querySelectorAll('.btn-del-row').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('¿Eliminar esta alerta?')) deleteAlerts([btn.dataset.id]);
      });
    });

    syncSelectAll(page);
    updateActionBar();
    renderAlertsPagination();
    enrichPageAddresses(page);
  }

  function syncSelectAll(page) {
    const pageIds = page.map(a => a.id);
    const allChk  = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
    const someChk = pageIds.some(id => selectedIds.has(id));
    chkSelectAll.checked       = allChk;
    chkSelectAll.indeterminate = !allChk && someChk;
  }

  function renderAlertsPagination() {
    const total = Math.ceil(filteredAlerts.length / ALERTS_PAGE_SIZE);
    if (total <= 1) { alertsPagination.innerHTML = ''; return; }
    let html = '';
    if (alertsPage > 1) html += `<button class="page-btn" data-p="${alertsPage - 1}">← Anterior</button>`;
    html += `<span class="page-info">Página ${alertsPage} de ${total} (${filteredAlerts.length} alertas)</span>`;
    if (alertsPage < total) html += `<button class="page-btn" data-p="${alertsPage + 1}">Siguiente →</button>`;
    alertsPagination.innerHTML = html;
    alertsPagination.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        alertsPage = parseInt(btn.dataset.p);
        renderAlertsTable();
        document.getElementById('alerts-section').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function updateActionBar() {
    const n = selectedIds.size;
    selectedCount.textContent = n === 0 ? '0 seleccionadas' : `${n} seleccionada${n !== 1 ? 's' : ''}`;
    btnDeleteBulk.disabled = n === 0;
  }

  async function deleteAlerts(ids) {
    if (!ids.length) return;
    const { error } = await supabase.from('alerts').delete().in('id', ids);
    if (error) { alert(`Error: ${error.message}`); return; }
    ids.forEach(id => { selectedIds.delete(id); delete addressCache[id]; });
    allAlerts = allAlerts.filter(a => !ids.includes(a.id));
    applyFilters();
  }

  // ── Reverse Geocoding ─────────────────────────────────────
  async function enrichPageAddresses(page) {
    const toFetch = page.filter(a => !(a.id in addressCache));
    if (!toFetch.length) return;
    toFetch.forEach(a => { if (!geocodeQueue.find(q => q.id === a.id)) geocodeQueue.push(a); });
    if (geocoding) return;
    geocoding = true;

    while (geocodeQueue.length) {
      const a = geocodeQueue.shift();
      if (a.id in addressCache) continue;
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${a.lat}&lon=${a.lng}&zoom=17&addressdetails=0`;
        const res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        const json = await res.json();
        addressCache[a.id] = json.display_name
          ? json.display_name.split(',').slice(0, 3).join(', ')
          : `${parseFloat(a.lat).toFixed(4)}, ${parseFloat(a.lng).toFixed(4)}`;
      } catch {
        addressCache[a.id] = `${parseFloat(a.lat).toFixed(4)}, ${parseFloat(a.lng).toFixed(4)}`;
      }
      const cell = document.getElementById(`addr-${a.id}`);
      if (cell) cell.textContent = addressCache[a.id];
      await new Promise(r => setTimeout(r, NOMINATIM_DELAY));
    }
    geocoding = false;
  }

  // ── Wire Filters ──────────────────────────────────────────
  function wireFilters() {
    [fEmail, fDateFrom, fDateTo, fTimeFrom, fTimeTo, fAddress].forEach(el => {
      el.addEventListener('input', applyFilters);
    });

    btnClearFilters.addEventListener('click', () => {
      fEmail.value = fDateFrom.value = fDateTo.value = fTimeFrom.value = fTimeTo.value = fAddress.value = '';
      applyFilters();
    });

    chkSelectAll.addEventListener('change', () => {
      const start   = (alertsPage - 1) * ALERTS_PAGE_SIZE;
      const pageIds = filteredAlerts.slice(start, start + ALERTS_PAGE_SIZE).map(a => a.id);
      pageIds.forEach(id => { if (chkSelectAll.checked) selectedIds.add(id); else selectedIds.delete(id); });
      renderAlertsTable();
    });

    btnDeleteBulk.addEventListener('click', () => {
      const ids = [...selectedIds];
      if (!ids.length) return;
      if (confirm(`¿Eliminar ${ids.length} alerta${ids.length !== 1 ? 's' : ''}?`)) deleteAlerts(ids);
    });
  }

  // ══════════════════════════════════════════════════════════
  // USERS TABLE
  // ══════════════════════════════════════════════════════════

  function renderTable() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    usersTbody.innerHTML = page.map(u => {
      const regDate   = new Date(u.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const lastAlert = u.last_alert ? formatTimeAgo(u.last_alert) : '<span class="text-muted">Nunca</span>';
      const pushBadge = u.push_active
        ? '<span class="push-yes"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Si</span>'
        : '<span class="push-no"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> No</span>';
      return `
        <tr>
          <td class="td-email">${escHtml(u.email)}</td>
          <td class="td-center td-alerts">${u.alerts}</td>
          <td class="td-center">${lastAlert}</td>
          <td class="td-center">${pushBadge}</td>
          <td class="td-center td-date">${regDate}</td>
        </tr>`;
    }).join('');

    renderPagination();
  }

  function renderPagination() {
    const total = Math.ceil(filtered.length / PAGE_SIZE);
    if (total <= 1) { pagination.innerHTML = ''; return; }
    let html = '';
    if (currentPage > 1) html += `<button class="page-btn" data-p="${currentPage - 1}">← Anterior</button>`;
    html += `<span class="page-info">Página ${currentPage} de ${total} (${filtered.length} usuarios)</span>`;
    if (currentPage < total) html += `<button class="page-btn" data-p="${currentPage + 1}">Siguiente →</button>`;
    pagination.innerHTML = html;
    pagination.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPage = parseInt(btn.dataset.p);
        renderTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // ── Sort ──────────────────────────────────────────────────
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = -1; }
      document.querySelectorAll('.sortable').forEach(t => t.classList.remove('active'));
      th.classList.add('active');
      th.textContent = `${col === 'alerts' ? 'Alertas' : col} ${sortDir === -1 ? '↓' : '↑'}`;
      filtered.sort((a, b) => sortDir * (b[sortCol] - a[sortCol]));
      currentPage = 1;
      renderTable();
    });
  });

  // ── User Search ───────────────────────────────────────────
  userSearch.addEventListener('input', () => {
    const q = userSearch.value.trim().toLowerCase();
    filtered = q ? allUsers.filter(u => u.email.toLowerCase().includes(q)) : [...allUsers];
    filtered.sort((a, b) => sortDir * (b[sortCol] - a[sortCol]));
    currentPage = 1;
    renderTable();
  });

  // ── Logout ────────────────────────────────────────────────
  btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  // ── Utilities ─────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Start ─────────────────────────────────────────────────
  boot();

})();
