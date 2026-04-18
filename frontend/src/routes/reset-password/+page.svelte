<script lang="ts">
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/auth';
  import { auth } from '$lib/stores/auth';
  import Logo from '$lib/components/Logo.svelte';

  let password = $state('');
  let confirm = $state('');
  let loading = $state(false);
  let error = $state('');
  let done = $state(false);
  let recoveryReady = $state(false);

  // Supabase emits PASSWORD_RECOVERY when the recovery link's hash is parsed.
  // Until that fires, we don't have a session to update.
  $effect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        recoveryReady = true;
      }
    });
    // Also accept an existing session — covers reload after the hash was already parsed
    if ($auth.session) recoveryReady = true;
    return () => data.subscription.unsubscribe();
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    if (password !== confirm) {
      error = 'Passwords do not match.';
      return;
    }
    if (password.length < 8) {
      error = 'Password must be at least 8 characters.';
      return;
    }
    loading = true;
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      error = err.message;
      loading = false;
      return;
    }
    done = true;
    loading = false;
    setTimeout(() => goto('/prospects'), 1500);
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  <div class="w-full max-w-sm px-6">
    <div class="flex items-center gap-2.5 mb-1">
      <Logo size={32} class="text-accent" />
      <h1 class="font-mono text-2xl font-semibold text-text">Lead Ace</h1>
    </div>
    <p class="text-text-muted text-sm mb-8">Choose a new password</p>

    {#if done}
      <p class="text-text-secondary text-sm">
        Password updated. Redirecting...
      </p>
    {:else if !recoveryReady && !$auth.session}
      <p class="text-text-secondary text-sm">
        This link is invalid or has expired.
        <a href="/forgot-password" class="underline hover:text-text">Request a new one</a>.
      </p>
    {:else}
      <form onsubmit={handleSubmit} class="space-y-4">
        <div>
          <label for="password" class="block text-xs font-medium text-text-secondary mb-1">
            New password
          </label>
          <input
            id="password"
            type="password"
            bind:value={password}
            required
            minlength={8}
            autocomplete="new-password"
            class="w-full rounded-md bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <label for="confirm" class="block text-xs font-medium text-text-secondary mb-1">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            bind:value={confirm}
            required
            minlength={8}
            autocomplete="new-password"
            class="w-full rounded-md bg-surface px-3 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-accent/30"
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
          {loading ? 'Updating...' : 'Update password'}
        </button>
      </form>
    {/if}
  </div>
</div>
