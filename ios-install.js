// ============================================================
// ios-install.js - iOS PWA install prompt
// - If iOS + NOT Safari: shows banner asking user to open in Safari
//   (with copy-link button, since JS cannot force-open Safari)
// - If iOS + Safari + not installed: shows Add to Home Screen steps
// ============================================================

(function () {
  'use strict';

  const ua = navigator.userAgent;

  // Detect iOS (iPhone/iPad/iPod, excluding Windows Phone)
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  if (!isIOS) return;

  // Already installed as PWA — nothing to do
  if (window.navigator.standalone === true) return;

  // Detect Safari: has "Safari" but NOT "CriOS" (Chrome), "FxiOS" (Firefox),
  // "OPiOS" (Opera), "EdgiOS" (Edge), "GSA" (Google Search App), etc.
  const isSafari = /Safari/.test(ua) &&
    !/CriOS|FxiOS|OPiOS|EdgiOS|GSA|DuckDuckGo|Brave|YaBrowser|UCBrowser|SamsungBrowser/.test(ua);

  const DISMISS_KEY_SAFARI   = 'whistle_ios_install_dismissed';
  const DISMISS_KEY_BROWSER  = 'whistle_ios_browser_dismissed';
  const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  function isDismissed(key) {
    const ts = localStorage.getItem(key);
    return ts && Date.now() - parseInt(ts, 10) < DISMISS_TTL;
  }

  // Only show the "Add to Home Screen" install banner on app pages (after login),
  // not on the login page itself.
  const isLoginPage = /login\.html/i.test(window.location.pathname) ||
                      window.location.pathname === '/' && document.getElementById('login-card') !== null;

  if (!isSafari) {
    // ── Wrong browser: ask user to open in Safari ──────────────
    if (isDismissed(DISMISS_KEY_BROWSER)) return;
    setTimeout(showOpenInSafariBanner, 1000);
  } else if (!isLoginPage) {
    // ── Safari + app page + not installed: show Add to Home Screen steps ─
    if (isDismissed(DISMISS_KEY_SAFARI)) return;
    setTimeout(showInstallBanner, 1200);
  }

  // ── Banner: "Open in Safari" ─────────────────────────────────
  function showOpenInSafariBanner() {
    if (document.getElementById('ios-install-banner')) return;

    // Build a safari-https:// URL — iOS opens this directly in Safari
    // from any other browser (Chrome, Firefox, Edge, etc.)
    const httpsUrl = window.location.href.replace(/^https?:\/\//, '');
    const safariUrl = 'safari-https://' + httpsUrl;

    const banner = document.createElement('div');
    banner.id = 'ios-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Abrir en Safari');
    banner.innerHTML = `
      <button class="ios-install-close" id="ios-install-close" aria-label="Cerrar">✕</button>
      <div class="ios-install-icon">
        <img src="whistle-icon.png" alt="Whistle">
      </div>
      <div class="ios-install-body">
        <p class="ios-install-title">Ábrelo en Safari</p>
        <p class="ios-install-sub">Para instalar Whistle en tu iPhone y recibir notificaciones, necesitas abrirla en <strong>Safari</strong>.</p>
        <a class="ios-copy-btn" id="ios-open-safari" href="${safariUrl}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>
          Abrir en Safari
        </a>
      </div>
    `;

    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('ios-install-visible')));

    document.getElementById('ios-install-close').addEventListener('click', () => {
      dismiss(banner, DISMISS_KEY_BROWSER);
    });
  }

  // ── Banner: "Add to Home Screen" steps ───────────────────────
  function showInstallBanner() {
    if (document.getElementById('ios-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'ios-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar Whistle');
    banner.innerHTML = `
      <button class="ios-install-close" id="ios-install-close" aria-label="Cerrar">✕</button>
      <div class="ios-install-icon">
        <img src="whistle-icon.png" alt="Whistle">
      </div>
      <div class="ios-install-body">
        <p class="ios-install-title">Instala Whistle en tu iPhone</p>
        <p class="ios-install-sub">Para recibir alertas aunque tengas la app cerrada, agrégala a tu pantalla de inicio.</p>
        <ol class="ios-install-steps">
          <li>
            <span class="ios-install-step-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
            </span>
            Toca el botón <strong>Compartir</strong>
            <svg class="ios-share-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#007AFF" stroke-width="2.2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          </li>
          <li>
            <span class="ios-install-step-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            </span>
            Selecciona <strong>"Agregar a pantalla de inicio"</strong>
          </li>
          <li>
            <span class="ios-install-step-icon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            Toca <strong>"Agregar"</strong> arriba a la derecha
          </li>
        </ol>
      </div>
      <div class="ios-install-arrow">▼</div>
    `;

    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('ios-install-visible')));

    document.getElementById('ios-install-close').addEventListener('click', () => {
      dismiss(banner, DISMISS_KEY_SAFARI);
    });
  }

  function dismiss(banner, key) {
    banner.classList.remove('ios-install-visible');
    localStorage.setItem(key, Date.now().toString());
    setTimeout(() => banner.remove(), 350);
  }

})();
