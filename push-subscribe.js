// ============================================================
// push-subscribe.js - Web Push subscription manager
// Registers the Service Worker and subscribes the user to
// push notifications. Saves the subscription to Supabase so
// the Edge Function can send pushes even when browser is closed.
// ============================================================

(function () {
  'use strict';

  // VAPID public key (generated pair — keep private key only in Edge Function)
  const VAPID_PUBLIC_KEY = 'BAxRU43I8dD5FHefWnUFmFSVhOdexyPNcE1It1M7oIqRgGHXvv_9_oVqK9r0yVuOCNyVQiWytsdy9vCKGfqipeM';

  // Convert VAPID public key from base64url to Uint8Array
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  // Save subscription endpoint + keys to Supabase push_subscriptions table
  async function saveSubscription(subscription, userId) {
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const sub = subscription.toJSON();

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id:  userId,
          endpoint: sub.endpoint,
          p256dh:   sub.keys.p256dh,
          auth:     sub.keys.auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

    if (error) {
      console.warn('[Whistle Push] Could not save subscription:', error.message);
    } else {
      console.log('[Whistle Push] Subscription saved.');
    }
  }

  // Main: register SW + subscribe
  async function initPush(userId) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[Whistle Push] Push not supported in this browser.');
      return;
    }

    try {
      // Register (or get existing) service worker
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      // Check existing permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('[Whistle Push] Notification permission denied.');
        return;
      }

      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        // Subscribe with VAPID
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      // Save / refresh subscription in Supabase
      await saveSubscription(subscription, userId);

    } catch (err) {
      console.warn('[Whistle Push] initPush error:', err);
    }
  }

  // Expose globally so app.js can call it once the user ID is known
  window.initPush = initPush;

})();
