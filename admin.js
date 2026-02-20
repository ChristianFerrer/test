// ============================================================
// admin.js - Admin Dashboard Logic
// ============================================================

(function () {
  'use strict';

  const ADMIN_EMAIL     = 'christianferbol@gmail.com';
  const EDGE_FUNC_URL   = `${SUPABASE_URL}/functions/v1/admin-stats`;
  const PAGE_SIZE       = 20;

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── DOM refs ─────────────────────────────────────────────
  const loading        = document.getElementById('admin-loading');
  const dashboard      = document.getElementById('admin-dashboard');
  const btnLogout      = document.getElementById('btn-logout');
  const userSearch     = document.getElementById('user-search');
  const usersTbody     = document.getElementById('users-tbody');
  const pagination     = document.getElementById('table-pagination');
  const alertSearch    = document.getElementById('alert-search');
  const alertsTbody    = document.getElementById('alerts-tbody');
  const alertsPagination = document.getElementById('alerts-pagination');

  // ── State ─────────────────────────────────────────────────
  let allUsers      = [];
  let filtered      = [];
  let currentPage   = 1;
  let sortCol       = 'alerts';
  let sortDir       = -1;

  let allAlerts     = [];
  let filteredAlerts = [];
  let alertsPage    = 1;
  const ALERTS_PAGE_SIZE = 20;

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

    // Fetch stats from Edge Function
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
    filteredAlerts = [...allAlerts];
    renderAlertsTable();

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
    const wrap = document.getElementById('chart-wrap');
    const entries = Object.entries(alertsByDay);
    const max = Math.max(...entries.map(e => e[1]), 1);

    wrap.innerHTML = entries.map(([date, count]) => {
      const pct = Math.round((count / max) * 100);
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
      const pct = Math.round((r.count / maxCount) * 100);
      const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
      return `
        <div class="top-row">
          <span class="top-medal">${medal}</span>
          <span class="top-email">${r.email}</span>
          <div class="top-bar-track">
            <div class="top-bar" style="width:${pct}%"></div>
          </div>
          <span class="top-count">${r.count}</span>
        </div>`;
    }).join('');
  }

  // ── Alerts Table ──────────────────────────────────────────
  function renderAlertsTable() {
    const start = (alertsPage - 1) * ALERTS_PAGE_SIZE;
    const page  = filteredAlerts.slice(start, start + ALERTS_PAGE_SIZE);

    if (!page.length) {
      alertsTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">Sin alertas</td></tr>';
      alertsPagination.innerHTML = '';
      return;
    }

    alertsTbody.innerHTML = page.map(a => {
      const dt = new Date(a.created_at);
      const fecha = dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const hora  = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const lat   = parseFloat(a.lat).toFixed(5);
      const lng   = parseFloat(a.lng).toFixed(5);
      const mapUrl = `https://www.google.com/maps?q=${a.lat},${a.lng}`;
      return `
        <tr>
          <td class="td-email">${a.email}</td>
          <td class="td-center td-date">${fecha} ${hora}</td>
          <td class="td-center td-coord">${lat}</td>
          <td class="td-center td-coord">${lng}</td>
          <td class="td-center"><a class="map-link" href="${mapUrl}" target="_blank" rel="noopener">📍 Ver</a></td>
        </tr>`;
    }).join('');

    // Pagination
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
      });
    });
  }

  // ── Users Table ───────────────────────────────────────────
  function renderTable() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const page  = filtered.slice(start, start + PAGE_SIZE);

    usersTbody.innerHTML = page.map(u => {
      const regDate    = new Date(u.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const lastAlert  = u.last_alert
        ? formatTimeAgo(u.last_alert)
        : '<span style="color:var(--text-muted)">Nunca</span>';
      const pushBadge  = u.push_active
        ? '<span class="push-yes">✅ Sí</span>'
        : '<span class="push-no">❌ No</span>';
      return `
        <tr>
          <td class="td-email">${u.email}</td>
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

  // ── Search ────────────────────────────────────────────────
  userSearch.addEventListener('input', () => {
    const q = userSearch.value.trim().toLowerCase();
    filtered = q
      ? allUsers.filter(u => u.email.toLowerCase().includes(q))
      : [...allUsers];
    // Re-apply sort
    filtered.sort((a, b) => sortDir * (b[sortCol] - a[sortCol]));
    currentPage = 1;
    renderTable();
  });

  // ── Alert Search ──────────────────────────────────────────
  alertSearch.addEventListener('input', () => {
    const q = alertSearch.value.trim().toLowerCase();
    filteredAlerts = q
      ? allAlerts.filter(a =>
          a.email.toLowerCase().includes(q) ||
          String(a.lat).includes(q) ||
          String(a.lng).includes(q)
        )
      : [...allAlerts];
    alertsPage = 1;
    renderAlertsTable();
  });

  // ── Logout ────────────────────────────────────────────────
  btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  // ── Start ─────────────────────────────────────────────────
  boot();

})();
