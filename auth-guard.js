// ============================================================
// auth-guard.js - Redirect to login if no active session
// Include this BEFORE app.js / history.js / profile.js
// ============================================================

(function () {
  'use strict';

  const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // getSession is synchronous-ish from cache; if no session → login
  _sb.auth.getSession().then(({ data: { session } }) => {
    if (!session) {
      window.location.replace('login.html');
    }
  });

  // Expose current user synchronously for other scripts
  window.__getAuthUser = async function () {
    const { data: { session } } = await _sb.auth.getSession();
    return session ? session.user : null;
  };

  window.__getAuthUserId = async function () {
    const user = await window.__getAuthUser();
    return user ? user.id : null;
  };
})();
