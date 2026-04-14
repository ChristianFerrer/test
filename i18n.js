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
    'map.tagline':          { es: 'Alerta de carteristas a tu alrededor', en: 'Pickpocket alerts around you' },
    'map.gps_searching':    { es: 'Buscando...',                 en: 'Searching...' },
    'map.gps_active':       { es: 'GPS activo',                   en: 'GPS active' },
    'map.gps_none':         { es: 'Sin GPS',                     en: 'No GPS' },
    'map.no_gps_browser':   { es: 'Tu navegador no soporta geolocalización', en: 'Your browser does not support geolocation' },
    'map.gps_error':        { es: 'Error de GPS: ',              en: 'GPS error: ' },
    'map.waiting_gps':      { es: 'Esperando señal GPS...',      en: 'Waiting for GPS signal...' },
    'map.send_error':       { es: 'Error al enviar la alerta. Inténtalo de nuevo.', en: 'Error sending alert. Please try again.' },
    'map.nearby_toast':     { es: 'Carterista reportado cerca de ti', en: 'Pickpocket reported near you' },
    'map.panel_safe_title':      { es: 'Zona Tranquila',                                     en: 'Safe zone' },
    'map.panel_safe_sub1':       { es: '0 alertas activas en 100 m.',                        en: '0 active alerts within 100m.' },
    'map.panel_safe_last':       { es: 'Última alerta hace {t}',                             en: 'Last alert {t} ago' },
    'map.panel_safe_no_history': { es: 'No hay alertas reportadas en el histórico',          en: 'No alerts reported in history' },
    'map.panel_title_one':  { es: 'Carterista en la zona',   en: 'Pickpocket in the area' },
    'map.panel_title_many': { es: 'Actividad elevada',        en: 'High activity' },
    'map.panel_sub_one':    { es: '1 alerta cercana',          en: '1 nearby alert' },
    'map.panel_sub_many':   { es: '{n} alertas cercanas',      en: '{n} nearby alerts' },
    'map.own_panel_title':      { es: 'Alerta de carterista enviada!',        en: 'Pickpocket alert sent!' },
    'map.own_panel_reach':      { es: 'Alcance en 100 m: {n} personas aprox.', en: 'Reach within 100m: ~{n} people' },
    'map.own_panel_users_wait': { es: 'Personas alertadas: buscando...',       en: 'People alerted: searching...' },
    'map.own_panel_users_0':    { es: 'Personas alertadas: –',                 en: 'People alerted: –' },
    'map.own_panel_users_n':    { es: 'Personas alertadas: ~{n}',              en: 'People alerted: ~{n}' },
    'map.own_panel_duration':   { es: 'Duración restante: {t}',                en: 'Time remaining: {t}' },
    // kept for badge-click re-open (other users panel)
    'map.own_panel_no_others': { es: 'No hay otras alertas activas a tu alrededor', en: 'No other active alerts around you' },
    'map.own_panel_one':    { es: 'Hay 1 alerta activa a tu alrededor', en: 'There is 1 active alert around you' },
    'map.own_panel_many':   { es: 'Hay {n} alertas activas a tu alrededor', en: 'There are {n} active alerts around you' },
    'map.cancel_alert':     { es: 'Cancelar alerta',                    en: 'Cancel alert' },
    'map.cancel_success':   { es: 'Alerta cancelada',                   en: 'Alert cancelled' },
    'map.perm_title':       { es: 'Necesitamos tu ubicación',    en: 'We need your location' },
    'map.perm_body':        { es: 'Whistle necesita acceso a tu GPS para mostrarte alertas cercanas y avisarte de carteristas en tiempo real.', en: 'Whistle needs GPS access to show you nearby alerts and notify you of pickpockets in real time.' },
    'map.perm_btn':         { es: 'Activar ubicación',           en: 'Enable location' },
    'map.push_banner':      { es: 'Activa las notificaciones para recibir alertas cuando el app este cerrada', en: 'Enable notifications to receive alerts when the app is closed' },
    'map.push_btn':         { es: 'Activar',                     en: 'Enable' },
    'map.popup_title':      { es: 'Carterista detectado',        en: 'Pickpocket detected' },
    'map.popup_ago':        { es: 'justo ahora',                 en: 'just now' },
    'map.popup_ago_min':    { es: 'hace {n} min',                en: '{n} min ago' },
    'map.verified':         { es: '✓ Verificada por {n} personas', en: '✓ Verified by {n} people' },
    'map.heatmap_on':       { es: 'Zonas de riesgo',          en: 'Risk zones' },
    'map.heatmap_off':      { es: 'Ocultar zonas',             en: 'Hide zones' },
    'map.heatmap_legend':   { es: 'Nivel de riesgo histórico',   en: 'Historical risk level' },
    'map.heatmap_lo':       { es: 'Bajo',                        en: 'Low' },
    'map.heatmap_hi':       { es: 'Alto',                        en: 'High' },
    'map.heatmap_loading':  { es: 'Cargando zonas de riesgo...', en: 'Loading risk zones...' },
    'map.risk_zone_high':   { es: 'Zona de alto riesgo · {n} alertas recientes',       en: 'High risk zone · {n} recent alerts' },
    'map.risk_zone_low':    { es: 'Precaucion · {n} alerta cerca',                    en: 'Caution · {n} alert nearby' },
    'map.risk_surge':       { es: 'Actividad inusual · {n} alertas ({x}x lo habitual)', en: 'Unusual activity · {n} alerts ({x}x above normal)' },

    // ── NAV ────────────────────────────────────────────────────
    'nav.alert':            { es: 'Radar',                       en: 'Radar' },
    'nav.history':          { es: 'Historial',                   en: 'History' },
    'nav.profile':          { es: 'Perfil',                      en: 'Profile' },
    'nav.admin':            { es: 'Admin',                       en: 'Admin' },

    // ── HISTORY ────────────────────────────────────────────────
    'history.tagline':      { es: 'Historial de alerta de carteristas', en: 'Pickpocket alert history' },
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
    'history.filter_24h':   { es: '24h',                         en: '24h' },
    'history.filter_7d':    { es: '7 días',                      en: '7 days' },
    'history.filter_30d':   { es: '30 días',                     en: '30 days' },
    'history.summary_one':  { es: '1 alerta en tu zona',         en: '1 alert in your area' },
    'history.summary_many': { es: '{n} alertas · {z} zonas activas', en: '{n} alerts · {z} active zones' },
    'history.verified':     { es: '✓ Verificada',                en: '✓ Verified' },
    'history.empty_period': { es: 'Sin alertas en este período', en: 'No alerts in this period' },

    // ── PROFILE ────────────────────────────────────────────────
    'profile.title':        { es: 'Mi perfil',                   en: 'My profile' },
    'profile.loading':      { es: 'Cargando...',                 en: 'Loading...' },
    'profile.since':        { es: 'Miembro desde ',              en: 'Member since ' },
    'profile.stat_total':   { es: 'Alertas enviadas',            en: 'Alerts sent' },
    'profile.stat_today':   { es: 'Hoy',                         en: 'Today' },
    'profile.stat_streak':  { es: 'Racha',                       en: 'Streak' },
    'profile.stat_reach':   { es: '~Personas avisadas',          en: '~People warned' },
    'profile.my_alerts':    { es: 'Mis últimas alertas',         en: 'My recent alerts' },
    'map.calm_zone':        { es: 'Zona tranquila',            en: 'Quiet zone' },
    'profile.no_alerts':    { es: 'Aún no has enviado ninguna alerta', en: "You haven't sent any alerts yet" },
    'profile.no_alerts_sub':{ es: 'Usa el botón REPORTAR en el mapa para avisar a otros usuarios', en: 'Use the REPORT button on the map to warn other users' },
    'profile.error':        { es: 'Error al cargar tus alertas', en: 'Error loading your alerts' },
    'profile.anonymous':    { es: 'Usuario anónimo',             en: 'Anonymous user' },
    'profile.impact_title': { es: 'Has protegido a ~{n} personas', en: "You've protected ~{n} people" },
    'profile.impact_sub':   { es: 'con tus {n} alertas',          en: 'with your {n} alerts' },
    'profile.impact_share': { es: 'Compartir mi impacto',         en: 'Share my impact' },

    // ── SHARE ──────────────────────────────────────────────────
    'share.copied':         { es: 'Enlace copiado',               en: 'Link copied' },
    'share.warn_contacts':  { es: 'Avisar a contactos',           en: 'Warn contacts' },
    'share.after_send':     { es: 'Compartir',                    en: 'Share' },
    'share.msg_nearby':     { es: '⚠️ Acaban de reportar un carterista cerca de mí en Whistle. Instálala para recibir alertas como esta:', en: '⚠️ A pickpocket was just reported near me on Whistle. Install it to get alerts like this:' },
    'share.msg_sent':       { es: 'Acabo de reportar un carterista en Whistle 🚨 Instálala para que la red sea más fuerte:', en: 'I just reported a pickpocket on Whistle 🚨 Install it to make the network stronger:' },
    'share.msg_impact':     { es: 'He enviado {n} alertas de carteristas y protegido a ~{r} personas con Whistle 🛡️ Únete a la red ciudadana:', en: "I've sent {n} pickpocket alerts and protected ~{r} people with Whistle 🛡️ Join the citizen network:" },

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

    // ── ZONE INSIGHTS ─────────────────────────────────────────
    'zone.score_safe':      { es: 'Segura · {n}/100',          en: 'Safe · {n}/100' },
    'zone.score_moderate':  { es: 'Moderada · {n}/100',        en: 'Moderate · {n}/100' },
    'zone.score_risk':      { es: 'Riesgo · {n}/100',          en: 'Risk · {n}/100' },
    'zone.calm_min':        { es: 'Tranquila · {n}min',         en: 'Quiet · {n}min' },
    'zone.calm_h':          { es: 'Tranquila · {n}h',           en: 'Quiet · {n}h' },
    'zone.calm_d':          { es: 'Tranquila · {n}d',           en: 'Quiet · {n}d' },
    'zone.calm_long':       { es: 'Tranquila · 30d+',           en: 'Quiet · 30d+' },
    'zone.peak_hours':      { es: 'Pico hab.: {h1}h-{h2}h',   en: 'Usual peak: {h1}h-{h2}h' },
    // Status chip (always-visible top indicator)
    'zone.status_safe':   { es: 'Zona tranquila · 0 alertas en 100m',       en: 'Quiet zone · 0 alerts in 100m' },
    'zone.status_warn_1': { es: 'Precaucion · 1 alerta cercana',            en: 'Caution · 1 alert nearby' },
    'zone.status_warn_n': { es: 'Precaucion · {n} alertas cercanas',       en: 'Caution · {n} alerts nearby' },
    'zone.status_danger': { es: 'Actividad elevada · {n} alertas cercanas', en: 'High activity · {n} alerts nearby' },

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
