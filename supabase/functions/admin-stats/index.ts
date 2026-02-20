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

  // Decode JWT payload to get email (tokens from Supabase Auth are signed HS256)
  // We verify identity by checking the email claim in the JWT payload
  let userEmail: string | null = null;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    userEmail = payload.email ?? null;
  } catch {
    return json({ error: 'Invalid token' }, 401);
  }
  if (!userEmail) return json({ error: 'Invalid token' }, 401);
  if (userEmail !== ADMIN_EMAIL) return json({ error: 'Forbidden' }, 403);

  // ── Fetch all registered users ───────────────────────────
  const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) return json({ error: usersErr.message }, 500);
  const users = usersData.users;

  // ── Fetch all alerts ─────────────────────────────────────
  const { data: alerts, error: alertsErr } = await supabaseAdmin
    .from('alerts')
    .select('id, user_id, created_at')
    .order('created_at', { ascending: false });
  if (alertsErr) return json({ error: alertsErr.message }, 500);

  // ── Fetch push subscriptions ─────────────────────────────
  const { data: pushSubs, error: pushErr } = await supabaseAdmin
    .from('push_subscriptions')
    .select('user_id, endpoint, updated_at');
  if (pushErr) return json({ error: pushErr.message }, 500);

  // ── Compute stats ─────────────────────────────────────────
  const now = Date.now();
  const h24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const d7  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const alertsLast24h = alerts.filter(a => a.created_at >= h24).length;
  const alertsLast7d  = alerts.filter(a => a.created_at >= d7).length;
  const alertsLast30d = alerts.filter(a => a.created_at >= d30).length;

  // Alerts per user (map userId → count)
  const alertsByUser: Record<string, number> = {};
  const lastAlertByUser: Record<string, string> = {};
  for (const a of alerts) {
    alertsByUser[a.user_id] = (alertsByUser[a.user_id] || 0) + 1;
    if (!lastAlertByUser[a.user_id]) lastAlertByUser[a.user_id] = a.created_at;
  }

  // Push subs set (userId → endpoint)
  const pushByUser = new Set(pushSubs.map(p => p.user_id));

  // Alerts per day for last 7 days
  const alertsByDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    alertsByDay[key] = 0;
  }
  for (const a of alerts.filter(a => a.created_at >= d7)) {
    const key = a.created_at.slice(0, 10);
    if (key in alertsByDay) alertsByDay[key]++;
  }

  // Top 5 reporters (last 30 days)
  const alertsByUserLast30: Record<string, number> = {};
  for (const a of alerts.filter(a => a.created_at >= d30)) {
    alertsByUserLast30[a.user_id] = (alertsByUserLast30[a.user_id] || 0) + 1;
  }
  const top5 = Object.entries(alertsByUserLast30)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, count]) => {
      const u = users.find(u => u.id === userId);
      return { userId, email: u?.email ?? userId.slice(0, 8) + '…', count };
    });

  // Build user list with enriched data
  const userList = users.map(u => ({
    id:          u.id,
    email:       u.email ?? '—',
    created_at:  u.created_at,
    alerts:      alertsByUser[u.id] ?? 0,
    last_alert:  lastAlertByUser[u.id] ?? null,
    push_active: pushByUser.has(u.id),
  })).sort((a, b) => b.alerts - a.alerts);

  return json({
    kpi: {
      total_users:    users.length,
      total_alerts:   alerts.length,
      push_subs:      pushSubs.length,
      alerts_24h:     alertsLast24h,
      alerts_7d:      alertsLast7d,
      alerts_30d:     alertsLast30d,
    },
    alerts_by_day: alertsByDay,
    top5_reporters: top5,
    users: userList,
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
