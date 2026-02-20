// ============================================================
// supabase/functions/send-push-notification/index.ts
// Supabase Edge Function — triggered by DB Webhook on INSERT
// into the `alerts` table. Sends Web Push to nearby subscribers.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

// ── VAPID config (set these in Supabase Dashboard > Edge Functions > Secrets) ──
const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@whistle.app';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ── Supabase service-role client (to read push_subscriptions) ──
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Haversine distance in meters ──────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ALERT_RADIUS_M = 50; // same as client

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  try {
    // Supabase DB Webhook sends the new row as JSON body
    const body = await req.json();
    const alert = body.record ?? body; // handle both webhook formats

    const alertLat = parseFloat(alert.lat);
    const alertLng = parseFloat(alert.lng);
    const alertUserId = alert.user_id;

    if (isNaN(alertLat) || isNaN(alertLng)) {
      return new Response('Invalid coordinates', { status: 400 });
    }

    // Fetch all push subscriptions (except the alerter's own)
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id, lat, lng')
      .neq('user_id', alertUserId);

    if (error) throw error;

    if (!subs || subs.length === 0) {
      return new Response('No subscribers', { status: 200 });
    }

    const payload = JSON.stringify({
      title: '⚠️ Whistle — Carterista detectado',
      body:  'Se ha reportado un carterista cerca de tu ubicación. ¡Ten cuidado!',
      icon:  '/thief2.png',
      badge: '/thief2.png',
      tag:   'whistle-alert',
      url:   '/',
    });

    // Send push only to subscribers within radius
    const sends = subs
      .filter((sub) => {
        // If subscriber has stored their last known lat/lng, use it for filtering
        if (sub.lat != null && sub.lng != null) {
          const dist = haversineDistance(alertLat, alertLng, parseFloat(sub.lat), parseFloat(sub.lng));
          return dist <= ALERT_RADIUS_M;
        }
        // If no location stored, send to all (conservative)
        return true;
      })
      .map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err: any) {
          // 410 Gone = subscription expired, remove it
          if (err.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          } else {
            console.warn('Push failed for', sub.endpoint, err.message);
          }
        }
      });

    await Promise.allSettled(sends);

    return new Response(JSON.stringify({ sent: sends.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[send-push-notification]', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
