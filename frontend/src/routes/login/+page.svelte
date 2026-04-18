<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/auth';
  import Logo from '$lib/components/Logo.svelte';

  let mode = $state<'signin' | 'signup'>(
    page.url.searchParams.get('mode') === 'signup' ? 'signup' : 'signin',
  );
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let info = $state('');
  let loading = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    info = '';
    loading = true;
    if (mode === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) error = err.message;
    } else {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (err) {
        error = err.message;
      } else if (data.session) {
        // Email confirmation disabled — user is signed in immediately
      } else {
        info = 'Check your email to confirm your account.';
      }
    }
    loading = false;
  }

  async function handleGoogle() {
    error = '';
    info = '';
    loading = true;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      error = err.message;
      loading = false;
    }
    // On success the browser is redirected to Google; no further UI update needed.
  }

  function toggleMode() {
    mode = mode === 'signin' ? 'signup' : 'signin';
    error = '';
    info = '';
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  <div class="w-full max-w-sm px-6">
    <div class="flex items-center gap-2.5 mb-1">
      <Logo size={32} class="text-accent" />
      <h1 class="font-mono text-2xl font-semibold text-text">Lead Ace</h1>
    </div>
    <p class="text-text-muted text-sm mb-8">
      {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
    </p>

    <button
      type="button"
      onclick={handleGoogle}
      disabled={loading}
      class="w-full rounded-md border border-border bg-page py-2 text-sm font-medium text-text transition-colors hover:bg-surface disabled:opacity-50 flex items-center justify-center gap-2"
    >
      <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.32z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"
        />
      </svg>
      Continue with Google
    </button>

    <div class="my-5 flex items-center gap-3 text-[11px] text-text-muted">
      <span class="h-px flex-1 bg-text/10"></span>
      <span>or</span>
      <span class="h-px flex-1 bg-text/10"></span>
    </div>

    <form onsubmit={handleSubmit} class="space-y-4">
      <div>
        <label for="email" class="block text-xs font-medium text-text-secondary mb-1">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          required
          autocomplete="email"
          class="w-full rounded-md bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30 placeholder:text-text-muted"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label for="password" class="block text-xs font-medium text-text-secondary mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          minlength={8}
          autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
          class="w-full rounded-md bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Password'}
        />
      </div>

      {#if error}
        <p class="text-accent text-xs">{error}</p>
      {/if}
      {#if info}
        <p class="text-text-secondary text-xs">{info}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full rounded-md bg-text py-2 text-sm font-medium text-page transition-colors hover:bg-text/90 disabled:opacity-50"
      >
        {loading
          ? mode === 'signin'
            ? 'Signing in...'
            : 'Creating account...'
          : mode === 'signin'
            ? 'Sign in'
            : 'Create account'}
      </button>
    </form>

    <div class="mt-6 flex items-center justify-between text-xs">
      <button
        type="button"
        onclick={toggleMode}
        class="text-text-muted hover:text-text transition-colors"
      >
        {mode === 'signin' ? 'Create an account' : 'Sign in instead'}
      </button>
      {#if mode === 'signin'}
        <a href="/forgot-password" class="text-text-muted hover:text-text transition-colors">
          Forgot password?
        </a>
      {/if}
    </div>

    <p class="mt-10 text-[11px] text-text-muted text-center">
      By continuing, you agree to the
      <a href="/terms" class="underline hover:text-text">Terms</a>
      and
      <a href="/privacy" class="underline hover:text-text">Privacy Policy</a>.
    </p>
  </div>
</div>
