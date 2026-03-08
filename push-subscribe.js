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

  // Save subscription endpoint + keys + current position to Supabase
  // lat/lng are stored so the Edge Function can apply the 100m distance filter
  async function saveSubscription(subscription, userId, lat, lng) {
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const sub = subscription.toJSON();

    const record = {
      user_id:    userId,
      endpoint:   sub.endpoint,
      p256dh:     sub.keys.p256dh,
      auth:       sub.keys.auth,
      updated_at: new Date().toISOString(),
    };

    // Include location if available — required for distance filtering
    if (lat != null && lng != null) {
      record.lat = lat;
      record.lng = lng;
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(record, { onConflict: 'endpoint' });

    if (error) {
      console.warn('[Whistle Push] Could not save subscription:', error.message);
    } else {
      console.log('[Whistle Push] Subscription saved with location:', lat, lng);
    }
  }

  // Actually subscribe and save
  async function doSubscribe(registration, userId, lat, lng) {
    try {
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      await saveSubscription(subscription, userId, lat, lng);
      // Hide banner on success
      const banner = document.getElementById('push-banner');
      if (banner) banner.classList.add('hidden');
    } catch (err) {
      console.warn('[Whistle Push] doSubscribe error:', err);
    }
  }

  // Main: register SW + handle permission flow
  // position = { lat, lng } — pass current GPS position for distance filtering
  async function initPush(userId, position) {
    const lat = (position && position.lat != null) ? position.lat : null;
    const lng = (position && position.lng != null) ? position.lng : null;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[Whistle Push] Push not supported in this browser.');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      const currentPermission = Notification.permission;

      if (currentPermission === 'granted') {
        // Already granted — subscribe silently
        await doSubscribe(registration, userId, lat, lng);
        return;
      }

      if (currentPermission === 'denied') {
        // User blocked notifications — nothing we can do
        console.log('[Whistle Push] Notifications blocked by user.');
        return;
      }

      // Permission is 'default' — show banner and wait for user tap
      // (Safari iOS requires a user gesture before requestPermission)
      const banner = document.getElementById('push-banner');
      const bannerBtn = document.getElementById('push-banner-btn');

      if (banner && bannerBtn) {
        banner.classList.remove('hidden');
        bannerBtn.addEventListener('click', async () => {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            await doSubscribe(registration, userId, lat, lng);
          } else {
            banner.classList.add('hidden');
          }
        }, { once: true });
      }

    } catch (err) {
      console.warn('[Whistle Push] initPush error:', err);
    }
  }

  // Expose globally so app.js can call it once the user ID is known
  window.initPush = initPush;

})();
