<script lang="ts">
  import { supabase } from '$lib/auth';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      error = err.message;
    }
    loading = false;
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-white">
  <div class="w-full max-w-sm px-6">
    <h1 class="font-mono text-2xl font-semibold text-text mb-1">Lead Ace</h1>
    <p class="text-text-muted text-sm mb-8">Sign in to your account</p>

    <form onsubmit={handleLogin} class="space-y-4">
      <div>
        <label for="email" class="block text-xs font-medium text-text-secondary mb-1">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          required
          class="w-full rounded-md bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30 placeholder:text-text-muted"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label for="password" class="block text-xs font-medium text-text-secondary mb-1">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          class="w-full rounded-md bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
          placeholder="Password"
        />
      </div>

      {#if error}
        <p class="text-accent text-xs">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={loading}
        class="w-full rounded-md bg-text py-2 text-sm font-medium text-white transition-colors hover:bg-text/90 disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  </div>
</div>
