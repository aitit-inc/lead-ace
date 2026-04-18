<script lang="ts">
  import { supabase } from '$lib/auth';
  import Logo from '$lib/components/Logo.svelte';

  let email = $state('');
  let loading = $state(false);
  let error = $state('');
  let sent = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (err) {
      error = err.message;
    } else {
      sent = true;
    }
    loading = false;
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  <div class="w-full max-w-sm px-6">
    <div class="flex items-center gap-2.5 mb-1">
      <Logo size={32} class="text-accent" />
      <h1 class="font-mono text-2xl font-semibold text-text">Lead Ace</h1>
    </div>
    <p class="text-text-muted text-sm mb-8">Reset your password</p>

    {#if sent}
      <p class="text-text-secondary text-sm">
        If an account exists for <span class="font-mono">{email}</span>, you'll receive an email with
        a reset link shortly.
      </p>
      <a href="/login" class="mt-6 inline-block text-xs text-text-muted hover:text-text">
        ← Back to sign in
      </a>
    {:else}
      <form onsubmit={handleSubmit} class="space-y-4">
        <div>
          <label for="email" class="block text-xs font-medium text-text-secondary mb-1">
            Email
          </label>
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

        {#if error}
          <p class="text-danger text-xs">{error}</p>
        {/if}

        <button
          type="submit"
          disabled={loading}
          class="w-full rounded-md bg-text py-2 text-sm font-medium text-page transition-colors hover:bg-text/90 disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
      <a href="/login" class="mt-6 inline-block text-xs text-text-muted hover:text-text">
        ← Back to sign in
      </a>
    {/if}
  </div>
</div>
