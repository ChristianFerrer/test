// ============================================================
// login.js - Auth screen logic
// ============================================================

(function () {
  'use strict';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // If already logged in, redirect to app
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) redirectToApp();
  });

  // Also listen for OAuth redirect callback
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) redirectToApp();
  });

  function redirectToApp() {
    window.location.href = 'index.html';
  }

  // --- DOM ---
  const loginCard      = document.getElementById('login-card');
  const registerCard   = document.getElementById('register-card');
  const loginForm      = document.getElementById('login-form');
  const registerForm   = document.getElementById('register-form');
  const authError      = document.getElementById('auth-error');
  const registerError  = document.getElementById('register-error');
  const btnGoogle      = document.getElementById('btn-google');
  const btnShowReg     = document.getElementById('btn-show-register');
  const btnShowLogin   = document.getElementById('btn-show-login');
  const btnLogin       = document.getElementById('btn-login');
  const btnRegister    = document.getElementById('btn-register');

  // --- Ensure correct initial state ---
  showCard('login');

  function showCard(which) {
    if (which === 'login') {
      loginCard.style.display    = 'flex';
      registerCard.style.display = 'none';
    } else {
      loginCard.style.display    = 'none';
      registerCard.style.display = 'flex';
    }
  }

  // --- Toggle login / register ---
  btnShowReg.addEventListener('click', () => {
    showCard('register');
    clearError(authError);
  });

  btnShowLogin.addEventListener('click', () => {
    showCard('login');
    clearError(registerError);
  });

  // --- Google OAuth ---
  btnGoogle.addEventListener('click', async () => {
    setLoading(btnGoogle, true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/index.html' },
    });
    if (error) {
      showError(authError, error.message);
      setLoading(btnGoogle, false);
    }
  });

  // --- Email login ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(authError);
    setLoading(btnLogin, true);

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showError(authError, translateError(error.message));
      setLoading(btnLogin, false);
    }
    // on success: onAuthStateChange fires and redirects
  });

  // --- Email register ---
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(registerError);
    setLoading(btnRegister, true);

    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    const { error } = await supabase.auth.signUp({ email, password });

    if (error) {
      showError(registerError, translateError(error.message));
      setLoading(btnRegister, false);
    } else {
      // Show success message (Supabase may require email confirmation)
      registerForm.innerHTML = `
        <div class="auth-success">
          <div style="font-size:48px;margin-bottom:12px">✉️</div>
          <p style="font-weight:700;font-size:16px;margin-bottom:6px">¡Bienvenido a Whistle!</p>
          <p style="font-size:13px;color:var(--text-secondary)">
            Revisa tu email para confirmar tu cuenta.<br>
            Si no ves el correo, mira en spam.
          </p>
        </div>`;
    }
  });

  // --- Helpers ---
  function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function clearError(el) {
    el.textContent = '';
    el.classList.add('hidden');
  }

  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.6' : '1';
  }

  function translateError(msg) {
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (msg.includes('Email not confirmed'))       return 'Confirma tu email antes de entrar.';
    if (msg.includes('User already registered'))   return 'Ya existe una cuenta con ese email.';
    if (msg.includes('Password should be'))        return 'La contraseña debe tener al menos 6 caracteres.';
    if (msg.includes('rate limit'))                return 'Demasiados intentos. Espera un momento.';
    return msg;
  }

})();
