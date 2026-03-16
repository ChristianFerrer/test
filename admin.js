// ============================================================
// admin.js - Admin Dashboard Logic
// ============================================================

(function () {
  'use strict';

  const ADMIN_EMAIL      = 'christianferbol@gmail.com';
  const EDGE_FUNC_URL    = `${SUPABASE_URL}/functions/v1/admin-stats`;
  const PAGE_SIZE        = 20;
  const ALERTS_PAGE_SIZE = 20;
  const NOMINATIM_DELAY  = 1100; // ms between geocode requests (Nominatim rate limit)

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

  // Filter inputs
  const fEmail         = document.getElementById('f-email');
  const fDateFrom      = document.getElementById('f-date-from');
  const fDateTo        = document.getElementById('f-date-to');
  const fTimeFrom      = document.getElementById('f-time-from');
  const fTimeTo        = document.getElementById('f-time-to');
  const fAddress       = document.getElementById('f-address');
  const btnClearFilters = document.getElementById('btn-clear-filters');

  // Action bar
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
  const addressCache = {};   // alert id → address string
  let geocodeQueue   = [];
  let geocoding      = false;

  // ── Boot ─────────────────────────────────────────────────
  async function boot() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = 'login.html';
      return;
    }

    if (session.user.email !== ADMIN_EMAIL) {
      window.location.href = 'index.html';
      return;
    }

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
      loading.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Error al cargar: ${err.message}</p></div>`;
    }
  }

  // ── Render all sections ───────────────────────────────────
  function renderDashboard(data) {
    renderKPI(data.kpi);
    renderChart(data.alerts_by_day);
    renderTop5(data.top5_reporters);

    allUsers = data.users;
    filtered = [...allUsers];
    renderTable();

    allAlerts = data.alerts_list || [];
    applyFilters();
    wireFilters();

    loading.classList.add('hidden');
    dashboard.classList.remove('hidden');
  }

  // ── KPI Cards ─────────────────────────────────────────────
  function renderKPI(kpi) {
    document.getElementById('kpi-users').textContent  = kpi.total_users;
    document.getElementById('kpi-alerts').textContent = kpi.total_alerts;
    document.getElementById('kpi-push').textContent   = kpi.push_subs;
    document.getElementById('kpi-24h').textContent    = kpi.alerts_24h;
    document.getElementById('kpi-7d').textContent     = kpi.alerts_7d;
    document.getElementById('kpi-30d').textContent    = kpi.alerts_30d;
  }

  // ── Bar Chart (last 7 days) ────────────────────────────────
  function renderChart(alertsByDay) {
    const wrap    = document.getElementById('chart-wrap');
    const entries = Object.entries(alertsByDay);
    const max     = Math.max(...entries.map(e => e[1]), 1);

    wrap.innerHTML = entries.map(([date, count]) => {
      const pct   = Math.round((count / max) * 100);
      const label = new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
      return `
        <div class="chart-bar-wrap">
          <div class="chart-bar-track">
            <div class="chart-bar" style="height:${pct}%" title="${count} alertas"></div>
          </div>
          <div class="chart-count">${count}</div>
          <div class="chart-label">${label}</div>
        </div>`;
    }).join('');
  }

  // ── Top 5 Reporters ───────────────────────────────────────
  function renderTop5(top5) {
    const list = document.getElementById('top-list');
    if (!top5.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Sin datos</p>';
      return;
    }
    const maxCount = top5[0].count;
    list.innerHTML = top5.map((r, i) => {
      const pct   = Math.round((r.count / maxCount) * 100);
      const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
      return `
        <div class="top-row">
          <span class="top-medal">${medal}</span>
          <span class="top-email">${escHtml(r.email)}</span>
          <div class="top-bar-track">
            <div class="top-bar" style="width:${pct}%"></div>
          </div>
          <span class="top-count">${r.count}</span>
        </div>`;
    }).join('');
  }

  // ── Filter Logic ──────────────────────────────────────────
  function applyFilters() {
    const qEmail   = fEmail.value.trim().toLowerCase();
    const qAddr    = fAddress.value.trim().toLowerCase();
    const dateFrom = fDateFrom.value;   // 'YYYY-MM-DD' or ''
    const dateTo   = fDateTo.value;
    const timeFrom = fTimeFrom.value;   // 'HH:MM' or ''
    const timeTo   = fTimeTo.value;

    filteredAlerts = allAlerts.filter(a => {
      const dt      = new Date(a.created_at);
      const dateStr = dt.toISOString().slice(0, 10);    // 'YYYY-MM-DD'
      const timeStr = dt.toTimeString().slice(0, 5);    // 'HH:MM'

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

  // ── Alerts Table ──────────────────────────────────────────
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
          <td class="td-center td-map"><a class="map-link" href="${mapUrl}" target="_blank" rel="noopener">📍 Ver</a></td>
          <td class="td-center"><button class="btn-del-row" data-id="${a.id}" title="Eliminar alerta">🗑</button></td>
        </tr>`;
    }).join('');

    // Wire row checkboxes
    alertsTbody.querySelectorAll('.row-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) selectedIds.add(id);
        else             selectedIds.delete(id);
        const row = chk.closest('tr');
        if (row) row.classList.toggle('row-selected', chk.checked);
        syncSelectAll(page);
        updateActionBar();
      });
    });

    // Wire individual delete buttons
    alertsTbody.querySelectorAll('.btn-del-row').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('¿Eliminar esta alerta?')) deleteAlerts([btn.dataset.id]);
      });
    });

    // Sync select-all checkbox state
    syncSelectAll(page);
    updateActionBar();
    renderAlertsPagination();

    // Kick off lazy geocoding for this page
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

  // ── Action Bar ────────────────────────────────────────────
  function updateActionBar() {
    const n = selectedIds.size;
    selectedCount.textContent = n === 0
      ? '0 seleccionadas'
      : `${n} seleccionada${n !== 1 ? 's' : ''}`;
    btnDeleteBulk.disabled = n === 0;
  }

  // ── Delete Alerts ─────────────────────────────────────────
  async function deleteAlerts(ids) {
    if (!ids.length) return;

    const { error } = await supabase.from('alerts').delete().in('id', ids);
    if (error) {
      alert(`Error al eliminar: ${error.message}`);
      return;
    }

    // Remove from local state
    ids.forEach(id => {
      selectedIds.delete(id);
      delete addressCache[id];
    });
    allAlerts = allAlerts.filter(a => !ids.includes(a.id));
    applyFilters();
  }

  // ── Reverse Geocoding (Nominatim, lazy per page) ──────────
  async function enrichPageAddresses(page) {
    const toFetch = page.filter(a => !(a.id in addressCache));
    if (!toFetch.length) return;

    // Enqueue unique IDs
    toFetch.forEach(a => {
      if (!geocodeQueue.find(q => q.id === a.id)) geocodeQueue.push(a);
    });

    if (geocoding) return;
    geocoding = true;

    while (geocodeQueue.length) {
      const a = geocodeQueue.shift();
      if (a.id in addressCache) continue; // already resolved

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

      // Update the cell if it's still visible in the DOM
      const cell = document.getElementById(`addr-${a.id}`);
      if (cell) cell.textContent = addressCache[a.id];

      await new Promise(r => setTimeout(r, NOMINATIM_DELAY)); // respect rate limit
    }

    geocoding = false;
  }

  // ── Wire Filters & Action Bar ─────────────────────────────
  function wireFilters() {
    // Any filter input triggers applyFilters
    [fEmail, fDateFrom, fDateTo, fTimeFrom, fTimeTo, fAddress].forEach(el => {
      el.addEventListener('input', applyFilters);
    });

    btnClearFilters.addEventListener('click', () => {
      fEmail.value = fDateFrom.value = fDateTo.value = fTimeFrom.value = fTimeTo.value = fAddress.value = '';
      applyFilters();
    });

    // Select-all checkbox (current page only)
    chkSelectAll.addEventListener('change', () => {
      const start   = (alertsPage - 1) * ALERTS_PAGE_SIZE;
      const pageIds = filteredAlerts.slice(start, start + ALERTS_PAGE_SIZE).map(a => a.id);
      pageIds.forEach(id => {
        if (chkSelectAll.checked) selectedIds.add(id);
        else                      selectedIds.delete(id);
      });
      renderAlertsTable();
    });

    // Bulk delete
    btnDeleteBulk.addEventListener('click', () => {
      const ids = [...selectedIds];
      if (!ids.length) return;
      if (confirm(`¿Eliminar ${ids.length} alerta${ids.length !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) {
        deleteAlerts(ids);
      }
    });
  }

  // ── Users Table ───────────────────────────────────────────
  function renderTable() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    usersTbody.innerHTML = page.map(u => {
      const regDate   = new Date(u.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const lastAlert = u.last_alert
        ? formatTimeAgo(u.last_alert)
        : '<span style="color:var(--text-muted)">Nunca</span>';
      const pushBadge = u.push_active
        ? '<span class="push-yes">✅ Sí</span>'
        : '<span class="push-no">❌ No</span>';
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
    filtered = q
      ? allUsers.filter(u => u.email.toLowerCase().includes(q))
      : [...allUsers];
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
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Start ─────────────────────────────────────────────────
  boot();

})();
