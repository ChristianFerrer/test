// ============================================================
// supabase/functions/admin-stats/index.ts
// Admin dashboard stats — requires admin JWT to call
// Uses service_role key to access auth.admin.listUsers()
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ADMIN_EMAIL = 'christianferbol@gmail.com';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

Deno.serve(async (req: Request) => {
  // ── CORS preflight ───────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
      },
    });
  }

  // ── Verify caller is the admin ───────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);

  let userEmail: string | null = null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    userEmail = payload.email
      ?? payload.user_metadata?.email
      ?? payload.app_metadata?.email
      ?? null;
  } catch {
    return json({ error: 'Invalid token' }, 401);
  }
  if (!userEmail) return json({ error: 'Invalid token' }, 401);
  if (userEmail !== ADMIN_EMAIL) return json({ error: 'Forbidden' }, 403);

  // ── Fetch data ───────────────────────────────────────────
  const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return json({ error: usersErr.message }, 500);
  const users = usersData.users;

  const { data: alerts, error: alertsErr } = await supabaseAdmin
    .from('alerts')
    .select('id, user_id, lat, lng, created_at')
    .order('created_at', { ascending: false });
  if (alertsErr) return json({ error: alertsErr.message }, 500);

  const { data: pushSubs, error: pushErr } = await supabaseAdmin
    .from('push_subscriptions')
    .select('user_id, endpoint, updated_at');
  if (pushErr) return json({ error: pushErr.message }, 500);

  // ── Time boundaries ──────────────────────────────────────
  const now = Date.now();
  const h24  = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const d7   = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const d14  = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const d30  = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const d60  = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

  // ── Basic alert counts ───────────────────────────────────
  const alertsLast24h = alerts.filter(a => a.created_at >= h24).length;
  const alertsLast7d  = alerts.filter(a => a.created_at >= d7).length;
  const alertsLast30d = alerts.filter(a => a.created_at >= d30).length;

  // Previous periods for trend comparison
  const alertsPrev7d  = alerts.filter(a => a.created_at >= d14 && a.created_at < d7).length;
  const alertsPrev30d = alerts.filter(a => a.created_at >= d60 && a.created_at < d30).length;

  // ── Alerts per user ──────────────────────────────────────
  const alertsByUser: Record<string, number> = {};
  const lastAlertByUser: Record<string, string> = {};
  for (const a of alerts) {
    alertsByUser[a.user_id] = (alertsByUser[a.user_id] || 0) + 1;
    if (!lastAlertByUser[a.user_id]) lastAlertByUser[a.user_id] = a.created_at;
  }

  // Push subs set
  const pushByUser = new Set(pushSubs.map(p => p.user_id));

  // ══════════════════════════════════════════════════════════
  // GROWTH METRICS
  // ══════════════════════════════════════════════════════════

  // New users by period
  const newUsersToday = users.filter(u => u.created_at >= h24).length;
  const newUsers7d    = users.filter(u => u.created_at >= d7).length;
  const newUsers30d   = users.filter(u => u.created_at >= d30).length;
  const newUsersPrev7d  = users.filter(u => u.created_at >= d14 && u.created_at < d7).length;
  const newUsersPrev30d = users.filter(u => u.created_at >= d60 && u.created_at < d30).length;

  // User growth curve (cumulative, last 30 days)
  const userGrowth: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const usersUpToDate = users.filter(u => u.created_at.slice(0, 10) <= key).length;
    userGrowth[key] = usersUpToDate;
  }

  // Registration method breakdown
  let regEmail = 0;
  let regGoogle = 0;
  let regOther = 0;
  for (const u of users) {
    const provider = u.app_metadata?.provider ?? u.identities?.[0]?.provider ?? 'email';
    if (provider === 'google') regGoogle++;
    else if (provider === 'email') regEmail++;
    else regOther++;
  }

  // Push adoption rate
  const pushAdoptionRate = users.length > 0
    ? Math.round((pushByUser.size / users.length) * 100)
    : 0;

  // ══════════════════════════════════════════════════════════
  // ENGAGEMENT METRICS
  // ══════════════════════════════════════════════════════════

  // DAU: unique users who sent an alert in last 24h
  const dauSet = new Set(alerts.filter(a => a.created_at >= h24).map(a => a.user_id));
  const dau = dauSet.size;

  // WAU: unique users who sent an alert in last 7d
  const wauSet = new Set(alerts.filter(a => a.created_at >= d7).map(a => a.user_id));
  const wau = wauSet.size;

  // MAU: unique users who sent an alert in last 30d
  const mauSet = new Set(alerts.filter(a => a.created_at >= d30).map(a => a.user_id));
  const mau = mauSet.size;

  // Stickiness
  const stickiness = mau > 0 ? Math.round((dau / mau) * 100) : 0;

  // Alerts per active user (30d)
  const alertsPerActiveUser = mau > 0 ? +(alertsLast30d / mau).toFixed(1) : 0;

  // Active vs dormant
  const usersWithAlerts = Object.keys(alertsByUser).length;
  const dormantUsers = users.length - usersWithAlerts;
  const activeRate = users.length > 0 ? Math.round((usersWithAlerts / users.length) * 100) : 0;

  // Retention: users active this week who were also active previous week
  const prevWauSet = new Set(alerts.filter(a => a.created_at >= d14 && a.created_at < d7).map(a => a.user_id));
  let retained = 0;
  for (const uid of wauSet) {
    if (prevWauSet.has(uid)) retained++;
  }
  const retentionRate = prevWauSet.size > 0 ? Math.round((retained / prevWauSet.size) * 100) : 0;

  // ══════════════════════════════════════════════════════════
  // TEMPORAL PATTERNS
  // ══════════════════════════════════════════════════════════

  // Alerts by day (30 days)
  const alertsByDay30: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    alertsByDay30[key] = 0;
  }
  for (const a of alerts.filter(a => a.created_at >= d30)) {
    const key = a.created_at.slice(0, 10);
    if (key in alertsByDay30) alertsByDay30[key]++;
  }

  // Alerts by hour of day (all time, last 30d)
  const alertsByHour: number[] = new Array(24).fill(0);
  for (const a of alerts.filter(a => a.created_at >= d30)) {
    const hour = new Date(a.created_at).getHours();
    alertsByHour[hour]++;
  }

  // Weekday vs weekend (last 30d)
  let weekdayAlerts = 0;
  let weekendAlerts = 0;
  for (const a of alerts.filter(a => a.created_at >= d30)) {
    const day = new Date(a.created_at).getDay();
    if (day === 0 || day === 6) weekendAlerts++;
    else weekdayAlerts++;
  }

  // ══════════════════════════════════════════════════════════
  // GEOGRAPHIC METRICS
  // ══════════════════════════════════════════════════════════

  // Cluster alerts into zones (~500m radius) using simple grid
  const GRID_SIZE = 0.005; // ~500m in lat/lng
  const zoneCounts: Record<string, { lat: number; lng: number; count: number }> = {};
  for (const a of alerts.filter(a => a.created_at >= d30)) {
    const gridLat = Math.round(a.lat / GRID_SIZE) * GRID_SIZE;
    const gridLng = Math.round(a.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gridLat.toFixed(4)},${gridLng.toFixed(4)}`;
    if (!zoneCounts[key]) zoneCounts[key] = { lat: gridLat, lng: gridLng, count: 0 };
    zoneCounts[key].count++;
  }

  const topZones = Object.values(zoneCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const uniqueZones = Object.keys(zoneCounts).length;

  // ══════════════════════════════════════════════════════════
  // TOP 5 REPORTERS
  // ══════════════════════════════════════════════════════════

  const alertsByUserLast30: Record<string, number> = {};
  for (const a of alerts.filter(a => a.created_at >= d30)) {
    alertsByUserLast30[a.user_id] = (alertsByUserLast30[a.user_id] || 0) + 1;
  }
  const top5 = Object.entries(alertsByUserLast30)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, count]) => {
      const u = users.find(u => u.id === userId);
      return { userId, email: u?.email ?? userId.slice(0, 8) + '...', count };
    });

  // ══════════════════════════════════════════════════════════
  // USER & ALERT LISTS (operational)
  // ══════════════════════════════════════════════════════════

  const userList = users.map(u => ({
    id:          u.id,
    email:       u.email ?? '—',
    created_at:  u.created_at,
    alerts:      alertsByUser[u.id] ?? 0,
    last_alert:  lastAlertByUser[u.id] ?? null,
    push_active: pushByUser.has(u.id),
  })).sort((a, b) => b.alerts - a.alerts);

  const alertsList = alerts.slice(0, 200).map(a => {
    const u = users.find(u => u.id === a.user_id);
    return {
      id:         a.id,
      email:      u?.email ?? a.user_id.slice(0, 8) + '...',
      lat:        a.lat,
      lng:        a.lng,
      created_at: a.created_at,
    };
  });

  // ══════════════════════════════════════════════════════════
  // RESPONSE
  // ══════════════════════════════════════════════════════════

  return json({
    kpi: {
      total_users:    users.length,
      total_alerts:   alerts.length,
      push_subs:      pushSubs.length,
      push_adoption:  pushAdoptionRate,
      alerts_24h:     alertsLast24h,
      alerts_7d:      alertsLast7d,
      alerts_30d:     alertsLast30d,
      alerts_prev_7d: alertsPrev7d,
      alerts_prev_30d: alertsPrev30d,
    },
    growth: {
      new_today:      newUsersToday,
      new_7d:         newUsers7d,
      new_30d:        newUsers30d,
      new_prev_7d:    newUsersPrev7d,
      new_prev_30d:   newUsersPrev30d,
      user_curve:     userGrowth,
      reg_email:      regEmail,
      reg_google:     regGoogle,
      reg_other:      regOther,
    },
    engagement: {
      dau,
      wau,
      mau,
      stickiness,
      alerts_per_user: alertsPerActiveUser,
      active_users:    usersWithAlerts,
      dormant_users:   dormantUsers,
      active_rate:     activeRate,
      retention_rate:  retentionRate,
    },
    temporal: {
      alerts_by_day:  alertsByDay30,
      alerts_by_hour: alertsByHour,
      weekday_alerts: weekdayAlerts,
      weekend_alerts: weekendAlerts,
    },
    geographic: {
      unique_zones:   uniqueZones,
      top_zones:      topZones,
    },
    top5_reporters: top5,
    users:          userList,
    alerts_list:    alertsList,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
