<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/auth';

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

  function toggleMode() {
    mode = mode === 'signin' ? 'signup' : 'signin';
    error = '';
    info = '';
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-white">
  <div class="w-full max-w-sm px-6">
    <h1 class="font-mono text-2xl font-semibold text-text mb-1">Lead Ace</h1>
    <p class="text-text-muted text-sm mb-8">
      {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
    </p>

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
        class="w-full rounded-md bg-text py-2 text-sm font-medium text-white transition-colors hover:bg-text/90 disabled:opacity-50"
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
