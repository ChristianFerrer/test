// ============================================================
// i18n.js - Internationalization for Whistle
// Detects browser language and translates the UI.
// Supported: es (default), en
// Usage in HTML:  <span data-i18n="key"></span>
// Usage in JS:    t('key')  or  t('key', { n: 3 })
// ============================================================

(function () {
  'use strict';

  // ── Detect language ─────────────────────────────────────────
  const browserLang = (navigator.language || navigator.userLanguage || 'es').toLowerCase();
  const lang = browserLang.startsWith('es') ? 'es' : 'en';

  // ── Translations ────────────────────────────────────────────
  const translations = {

    // ── LOGIN ──────────────────────────────────────────────────
    'login.title':          { es: 'Iniciar sesión',              en: 'Sign in' },
    'login.google':         { es: 'Continuar con Google',        en: 'Continue with Google' },
    'login.or':             { es: 'o con email',                 en: 'or with email' },
    'login.email':          { es: 'Email',                       en: 'Email' },
    'login.password':       { es: 'Contraseña',                  en: 'Password' },
    'login.submit':         { es: 'Entrar',                      en: 'Sign in' },
    'login.no_account':     { es: '¿Sin cuenta?',                en: "Don't have an account?" },
    'login.create':         { es: 'Crear cuenta',                en: 'Create account' },
    'login.tagline':        { es: 'Identifica carteristas a tu alrededor', en: 'Identify pickpockets around you' },

    // ── REGISTER ───────────────────────────────────────────────
    'register.title':       { es: 'Crear cuenta',                en: 'Create account' },
    'register.password_ph': { es: 'Mínimo 6 caracteres',         en: 'At least 6 characters' },
    'register.submit':      { es: 'Crear cuenta',                en: 'Create account' },
    'register.have_account':{ es: '¿Ya tienes cuenta?',          en: 'Already have an account?' },
    'register.signin':      { es: 'Iniciar sesión',              en: 'Sign in' },
    'register.success_title':{ es: '¡Bienvenido a Whistle!',     en: 'Welcome to Whistle!' },
    'register.success_body': { es: 'Revisa tu email para confirmar tu cuenta. Si no ves el correo, mira en spam.', en: 'Check your email to confirm your account. If you don\'t see it, check your spam folder.' },

    // ── AUTH ERRORS ────────────────────────────────────────────
    'error.invalid_credentials': { es: 'Email o contraseña incorrectos.',             en: 'Incorrect email or password.' },
    'error.email_not_confirmed': { es: 'Confirma tu email antes de entrar.',           en: 'Please confirm your email before signing in.' },
    'error.already_registered':  { es: 'Ya existe una cuenta con ese email.',          en: 'An account with that email already exists.' },
    'error.password_too_short':  { es: 'La contraseña debe tener al menos 6 caracteres.', en: 'Password must be at least 6 characters.' },
    'error.rate_limit':          { es: 'Demasiados intentos. Espera un momento.',      en: 'Too many attempts. Please wait a moment.' },

    // ── INDEX / MAP ────────────────────────────────────────────
    'map.tagline':          { es: 'Alertas de carteristas a tu alrededor y en tiempo real', en: 'Real-time pickpocket alerts around you' },
    'map.gps_searching':    { es: 'Buscando...',                 en: 'Searching...' },
    'map.gps_active':       { es: 'GPS activo',                  en: 'GPS active' },
    'map.gps_none':         { es: 'Sin GPS',                     en: 'No GPS' },
    'map.no_gps_browser':   { es: 'Tu navegador no soporta geolocalización', en: 'Your browser does not support geolocation' },
    'map.gps_error':        { es: 'Error de GPS: ',              en: 'GPS error: ' },
    'map.waiting_gps':      { es: 'Esperando señal GPS...',      en: 'Waiting for GPS signal...' },
    'map.send_error':       { es: 'Error al enviar la alerta. Inténtalo de nuevo.', en: 'Error sending alert. Please try again.' },
    'map.nearby_toast':     { es: '🔔 Carterista reportado cerca de ti', en: '🔔 Pickpocket reported near you' },
    'map.panel_title_one':  { es: 'Carterista detectado cerca',  en: 'Pickpocket detected nearby' },
    'map.panel_title_many': { es: '{n} alertas en un radio de 200m', en: '{n} alerts within 200m' },
    'map.panel_sub_one':    { es: 'Hay 1 alerta activa en un radio de 200m', en: 'There is 1 active alert within 200m' },
    'map.panel_sub_many':   { es: 'Hay {n} alertas activas a tu alrededor', en: 'There are {n} active alerts around you' },
    'map.own_panel_title':  { es: 'Alerta de carteristas enviada a otros usuarios cerca', en: 'Pickpocket alert sent to nearby users' },
    'map.own_panel_no_others': { es: 'No hay otras alertas activas a tu alrededor', en: 'No other active alerts around you' },
    'map.own_panel_one':    { es: 'Hay 1 alerta activa a tu alrededor', en: 'There is 1 active alert around you' },
    'map.own_panel_many':   { es: 'Hay {n} alertas activas a tu alrededor', en: 'There are {n} active alerts around you' },
    'map.perm_title':       { es: 'Necesitamos tu ubicación',    en: 'We need your location' },
    'map.perm_body':        { es: 'Whistle necesita acceso a tu GPS para mostrarte alertas cercanas y avisarte de carteristas en tiempo real.', en: 'Whistle needs GPS access to show you nearby alerts and notify you of pickpockets in real time.' },
    'map.perm_btn':         { es: 'Activar ubicación',           en: 'Enable location' },
    'map.push_banner':      { es: '🔔 Activa las notificaciones para recibir alertas cuando el app esté cerrada', en: '🔔 Enable notifications to receive alerts when the app is closed' },
    'map.push_btn':         { es: 'Activar',                     en: 'Enable' },
    'map.popup_title':      { es: 'Carterista detectado',        en: 'Pickpocket detected' },
    'map.popup_ago':        { es: 'justo ahora',                 en: 'just now' },
    'map.popup_ago_min':    { es: 'hace {n} min',                en: '{n} min ago' },

    // ── NAV ────────────────────────────────────────────────────
    'nav.alert':            { es: 'Alertar',                     en: 'Alert' },
    'nav.history':          { es: 'Historial de alertas',        en: 'Alert history' },
    'nav.profile':          { es: 'Mi perfil',                   en: 'My profile' },
    'nav.admin':            { es: 'Admin',                       en: 'Admin' },

    // ── HISTORY ────────────────────────────────────────────────
    'history.tagline':      { es: 'Alertas de carteristas en las últimas 24h en 5km a la redonda', en: 'Pickpocket alerts in the last 24h within 5km' },
    'history.list':         { es: 'Lista',                       en: 'List' },
    'history.map':          { es: 'Mapa',                        en: 'Map' },
    'history.loading':      { es: 'Cargando alertas...',         en: 'Loading alerts...' },
    'history.empty':        { es: 'Sin alertas hoy en un radio de 5km', en: 'No alerts today within 5km' },
    'history.empty_sub':    { es: 'Las alertas aparecerán aquí cuando otros usuarios las reporten', en: 'Alerts will appear here when other users report them' },
    'history.error':        { es: 'Error al cargar el historial', en: 'Error loading history' },
    'history.error_sub':    { es: 'Verifica tu conexión e inténtalo de nuevo', en: 'Check your connection and try again' },
    'history.retry':        { es: 'Reintentar',                  en: 'Retry' },
    'history.no_gps':       { es: 'Geolocalización no disponible', en: 'Geolocation not available' },
    'history.need_gps':     { es: 'Necesitamos tu ubicación',   en: 'We need your location' },
    'history.need_gps_sub': { es: 'Activa el GPS para ver el historial de tu zona', en: 'Enable GPS to view alerts in your area' },
    'history.wait_gps':     { es: 'Esperando señal GPS...',      en: 'Waiting for GPS signal...' },
    'history.active':       { es: 'Activa',                      en: 'Active' },
    'history.expired':      { es: 'Expirada',                    en: 'Expired' },
    'history.loading_addr': { es: 'Cargando dirección...',       en: 'Loading address...' },
    'history.popup_title':  { es: 'Carterista detectado',        en: 'Pickpocket detected' },
    'history.distance':     { es: 'de distancia',                en: 'away' },

    // ── PROFILE ────────────────────────────────────────────────
    'profile.title':        { es: 'Mi perfil',                   en: 'My profile' },
    'profile.loading':      { es: 'Cargando...',                 en: 'Loading...' },
    'profile.since':        { es: 'Miembro desde ',              en: 'Member since ' },
    'profile.stat_total':   { es: 'Alertas enviadas',            en: 'Alerts sent' },
    'profile.stat_today':   { es: 'Hoy',                         en: 'Today' },
    'profile.stat_streak':  { es: 'Días activo',                 en: 'Active days' },
    'profile.my_alerts':    { es: 'Mis últimas alertas',         en: 'My recent alerts' },
    'profile.no_alerts':    { es: 'Aún no has enviado ninguna alerta', en: "You haven't sent any alerts yet" },
    'profile.no_alerts_sub':{ es: 'Usa el botón REPORTAR en el mapa para avisar a otros usuarios', en: 'Use the REPORT button on the map to warn other users' },
    'profile.error':        { es: 'Error al cargar tus alertas', en: 'Error loading your alerts' },
    'profile.anonymous':    { es: 'Usuario anónimo',             en: 'Anonymous user' },

    // ── TIME ───────────────────────────────────────────────────
    'time.now':             { es: 'ahora',                       en: 'now' },
    'time.mins_ago':        { es: 'hace {n}m',                   en: '{n}m ago' },
    'time.hours_ago':       { es: 'hace {n}h',                   en: '{n}h ago' },

    // ── iOS INSTALL ────────────────────────────────────────────
    'ios.safari_title':     { es: 'Ábrelo en Safari',            en: 'Open in Safari' },
    'ios.safari_sub':       { es: 'Para instalar Whistle y recibir notificaciones necesitas abrirla en <strong>Safari</strong>.', en: 'To install Whistle and receive notifications you need to open it in <strong>Safari</strong>.' },
    'ios.copy_btn':         { es: 'Copiar link',                 en: 'Copy link' },
    'ios.copy_hint':        { es: 'Luego abre <strong>Safari</strong>, toca la barra de dirección y pega.', en: 'Then open <strong>Safari</strong>, tap the address bar and paste.' },
    'ios.copied':           { es: '¡Copiado!',                   en: 'Copied!' },
    'ios.copy_again':       { es: 'Copiar link de nuevo',        en: 'Copy link again' },
    'ios.install_title':    { es: 'Instala Whistle en tu iPhone', en: 'Install Whistle on your iPhone' },
    'ios.install_sub':      { es: 'Para recibir alertas aunque tengas la app cerrada, agrégala a tu pantalla de inicio.', en: 'To receive alerts even when the app is closed, add it to your home screen.' },
    'ios.step1':            { es: 'Toca el botón <strong>Compartir</strong>', en: 'Tap the <strong>Share</strong> button' },
    'ios.step2':            { es: 'Selecciona <strong>"Agregar a pantalla de inicio"</strong>', en: 'Select <strong>"Add to Home Screen"</strong>' },
    'ios.step3':            { es: 'Toca <strong>"Agregar"</strong> arriba a la derecha', en: 'Tap <strong>"Add"</strong> in the top right' },

    // ── PUSH ───────────────────────────────────────────────────
    'push.not_supported':   { es: '[Whistle Push] Push no soportado en este navegador.', en: '[Whistle Push] Push not supported in this browser.' },
    'push.blocked':         { es: '[Whistle Push] Notificaciones bloqueadas por el usuario.', en: '[Whistle Push] Notifications blocked by user.' },
  };

  // ── Translate function ───────────────────────────────────────
  // t('key')            → translated string
  // t('key', { n: 5 }) → with {n} placeholder replaced
  window.t = function (key, vars) {
    const entry = translations[key];
    if (!entry) return key;
    let str = entry[lang] || entry['es'] || key;
    if (vars) {
      Object.keys(vars).forEach(k => {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return str;
  };

  // ── Apply to DOM via data-i18n attributes ────────────────────
  // <span data-i18n="key">fallback</span>
  // <input data-i18n-placeholder="key">
  // <meta data-i18n-content="key">  (for <title> etc.)
  function applyTranslations() {
    // Text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.innerHTML = window.t(key);
    });
    // Placeholder attributes
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = window.t(el.getAttribute('data-i18n-placeholder'));
    });
    // aria-label attributes
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', window.t(el.getAttribute('data-i18n-aria')));
    });
    // document title
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) document.title = window.t(titleEl.getAttribute('data-i18n'));
    // html lang attribute
    document.documentElement.lang = lang;
  }

  // Run immediately if DOM is ready, else wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTranslations);
  } else {
    applyTranslations();
  }

  // Expose lang for other scripts
  window.appLang = lang;

})();
