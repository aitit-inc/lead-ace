<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '$lib/stores/auth';
  import { supabase } from '$lib/auth';
  import { post, ApiError } from '$lib/api';
  import { isSafeRelativePath } from '$lib/redirect';

  let status = $state<'pending' | 'saving' | 'error'>('pending');
  let errorMessage = $state('');

  function nextTarget(): string {
    const next = page.url.searchParams.get('next');
    return next && isSafeRelativePath(next) ? next : '/prospects';
  }

  // After Google OAuth completes, the Supabase session contains
  // provider_refresh_token (only on the immediate sign-in event, not on
  // subsequent restores). Persist it to the backend so the Worker can mint
  // Gmail access tokens later.
  $effect(() => {
    if ($auth.loading) return;
    if (!$auth.session) {
      goto('/login', { replaceState: true });
      return;
    }
    if (status !== 'pending') return;
    void persistGoogleCredentials();
  });

  async function persistGoogleCredentials() {
    status = 'saving';
    const session = $auth.session;
    if (!session) return;

    const refreshToken = session.provider_refresh_token;
    const scope = (session as { provider_token_scope?: string }).provider_token_scope;
    const email = session.user.email;

    if (!refreshToken || !email) {
      // Restored session (refresh after first sign-in) — credentials already
      // saved in a previous callback. Just route to the app.
      goto(nextTarget(), { replaceState: true });
      return;
    }

    try {
      await post('/auth/google-credentials', {
        refreshToken,
        scope: scope ?? 'openid profile email https://www.googleapis.com/auth/gmail.send',
        email,
      });
      goto(nextTarget(), { replaceState: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        // gmail.send scope not granted — sign the user out and ask them to retry
        await supabase.auth.signOut();
        errorMessage =
          'gmail.send permission was not granted. LeadAce needs it to send outbound emails. Please sign in again and approve all requested scopes.';
        status = 'error';
        return;
      }
      errorMessage = e instanceof Error ? e.message : 'Failed to save Google credentials.';
      status = 'error';
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  {#if status === 'error'}
    <div class="max-w-sm px-6 text-center">
      <p class="text-danger text-sm mb-4">{errorMessage}</p>
      <a href="/login" class="text-text-muted hover:text-text text-xs underline">Back to sign in</a>
    </div>
  {:else}
    <p class="text-text-muted font-mono text-sm">Signing you in…</p>
  {/if}
</div>
