// ============================================================
// supabase/functions/send-push-notification/index.ts
// Supabase Edge Function — triggered by DB Webhook on INSERT
// into the `alerts` table. Sends Web Push using native crypto.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@whistle.app';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Base64url helpers ─────────────────────────────────────────
function base64urlToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Build VAPID Authorization header ─────────────────────────
async function buildVapidHeaders(endpoint: string, expiration = Math.floor(Date.now() / 1000) + 43200) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  // JWT header + payload
  const header  = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: expiration,
    sub: VAPID_SUBJECT,
  })));

  const signingInput = `${header}.${payload}`;

  // Import VAPID private key
  const privateKeyBytes = base64urlToUint8Array(VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${uint8ArrayToBase64url(new Uint8Array(signature))}`;

  return {
    Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    'Content-Type': 'application/octet-stream',
    'TTL': '86400',
  };
}

// ── Encrypt push message (AES-128-GCM) ───────────────────────
async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<{ body: Uint8Array; salt: string; serverPublicKey: string }> {
  const encoder = new TextEncoder();

  // Generate ephemeral ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // Import recipient public key
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    base64urlToUint8Array(p256dh),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );

  // Export server public key (raw)
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
  const serverPublicKeyBytes = new Uint8Array(serverPublicKeyRaw);

  // Auth secret
  const authBytes = base64urlToUint8Array(auth);

  // Salt (16 bytes random)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF to derive content encryption key and nonce
  const ikm = await crypto.subtle.importKey('raw', new Uint8Array(sharedSecret), 'HKDF', false, ['deriveBits']);

  // PRK from auth
  const prkAuthInfo = encoder.encode('Content-Encoding: auth\0');
  const prkAuthBytes = new Uint8Array([...prkAuthInfo]);
  const prk = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authBytes, info: prkAuthBytes },
    ikm,
    256
  );

  const prkKey = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);

  // Content encryption key
  const clientPublicKeyBytes = base64urlToUint8Array(p256dh);
  const keyInfoBytes = new Uint8Array([
    ...encoder.encode('Content-Encoding: aesgcm\0'),
    ...encoder.encode('P-256\0'),
    0, 65,
    ...clientPublicKeyBytes,
    0, 65,
    ...serverPublicKeyBytes,
  ]);

  const keyBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: keyInfoBytes },
    prkKey,
    128
  );

  // Nonce
  const nonceInfoBytes = new Uint8Array([
    ...encoder.encode('Content-Encoding: nonce\0'),
    ...encoder.encode('P-256\0'),
    0, 65,
    ...clientPublicKeyBytes,
    0, 65,
    ...serverPublicKeyBytes,
  ]);

  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfoBytes },
    prkKey,
    96
  );

  // Encrypt
  const contentKey = await crypto.subtle.importKey('raw', keyBits, { name: 'AES-GCM' }, false, ['encrypt']);
  const payloadBytes = encoder.encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 2);
  paddedPayload.set(payloadBytes, 2); // 2-byte padding length prefix = 0

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits },
    contentKey,
    paddedPayload
  );

  return {
    body: new Uint8Array(encrypted),
    salt: uint8ArrayToBase64url(salt),
    serverPublicKey: uint8ArrayToBase64url(serverPublicKeyBytes),
  };
}

// ── Send a single push notification ──────────────────────────
async function sendPush(endpoint: string, p256dh: string, auth: string, payload: string): Promise<number> {
  try {
    const { body, salt, serverPublicKey } = await encryptPayload(payload, p256dh, auth);
    const headers = await buildVapidHeaders(endpoint);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...headers,
        'Encryption': `salt=${salt}`,
        'Crypto-Key': `dh=${serverPublicKey};vapid=${VAPID_PUBLIC_KEY}`,
        'Content-Encoding': 'aesgcm',
      },
      body,
    });

    return res.status;
  } catch (err) {
    console.warn('sendPush error:', err);
    return 500;
  }
}

// ── Haversine distance in meters ──────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const alert = body.record ?? body;

    console.log('[push] New alert:', JSON.stringify(alert));

    const alertLat    = parseFloat(alert.lat);
    const alertLng    = parseFloat(alert.lng);
    const alertUserId = alert.user_id;

    if (isNaN(alertLat) || isNaN(alertLng)) {
      return new Response('Invalid coordinates', { status: 400 });
    }

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id, lat, lng');

    if (error) {
      console.error('[push] DB error:', error);
      throw error;
    }

    console.log(`[push] Found ${subs?.length ?? 0} subscriptions`);

    if (!subs || subs.length === 0) {
      return new Response('No subscribers', { status: 200 });
    }

    const payload = JSON.stringify({
      title: '⚠️ Whistle — Carterista detectado',
      body:  'Se ha reportado un carterista cerca de tu ubicación. ¡Ten cuidado!',
      icon:  '/thief2-icon.png',
      badge: '/thief2-icon.png',
      tag:   'whistle-alert',
      url:   '/',
    });

    let sent = 0;
    for (const sub of subs) {
      // Skip the alerter's own subscription
      if (sub.user_id === alertUserId) continue;

      // Distance filter (only if subscriber has location stored)
      if (sub.lat != null && sub.lng != null) {
        const dist = haversineDistance(alertLat, alertLng, parseFloat(sub.lat), parseFloat(sub.lng));
        if (dist > 50) continue;
      }

      const status = await sendPush(sub.endpoint, sub.p256dh, sub.auth, payload);
      console.log(`[push] Sent to ${sub.endpoint.slice(0, 40)}... status=${status}`);

      if (status === 410 || status === 404) {
        // Subscription expired — remove it
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      } else {
        sent++;
      }
    }

    return new Response(JSON.stringify({ sent }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[push] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
