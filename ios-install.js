// ============================================================
// ios-install.js - iOS PWA install prompt
// Shows a "Add to Home Screen" banner on iOS Safari when the
// app is not already installed as a PWA.
// Also prompts for push notifications after install (iOS 16.4+).
// ============================================================

(function () {
  'use strict';

  // Only run on iOS Safari (not Chrome/Firefox on iOS which can't install PWAs)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isInStandaloneMode = window.navigator.standalone === true;

  if (!isIOS || !isSafari || isInStandaloneMode) return;

  // Don't show again if user dismissed within the last 7 days
  const DISMISS_KEY = 'whistle_ios_install_dismissed';
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 60 * 60 * 1000) return;

  // Small delay so the page renders first
  setTimeout(showInstallBanner, 1200);

  function showInstallBanner() {
    // Don't show if already visible
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
        <p class="ios-install-sub">Para recibir alertas de carteristas aunque tengas la app cerrada, agrégala a tu pantalla de inicio.</p>
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

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('ios-install-visible'));
    });

    document.getElementById('ios-install-close').addEventListener('click', () => {
      dismiss(banner);
    });
  }

  function dismiss(banner) {
    banner.classList.remove('ios-install-visible');
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setTimeout(() => banner.remove(), 350);
  }

})();
