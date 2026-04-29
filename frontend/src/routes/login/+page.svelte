<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/auth';
  import { isSafeRelativePath } from '$lib/redirect';
  import Logo from '$lib/components/Logo.svelte';

  let error = $state('');
  let loading = $state(false);

  // gmail.send is the only Gmail scope LeadAce needs. It's Sensitive (not Restricted),
  // so verification doesn't require CASA. With this scope alone we can send from any
  // Send-As alias the user has already verified in their Gmail web UI — Gmail honors
  // the From: header for accepted aliases. Listing aliases programmatically would
  // require gmail.settings.basic / .sharing, both Restricted (CASA-gated), so we
  // intentionally let users type their alias address by hand instead.
  const GOOGLE_SCOPES = [
    'openid',
    'profile',
    'email',
    'https://www.googleapis.com/auth/gmail.send',
  ].join(' ');

  async function handleGoogle() {
    error = '';
    loading = true;
    // Persist `next` in sessionStorage instead of round-tripping through the
    // OAuth redirect URL. Supabase's allowlist-based redirect validation can
    // strip query params, which silently breaks deep-link returns. Storage
    // is per-tab, so concurrent OAuth flows in different tabs do not collide.
    const next = page.url.searchParams.get('next');
    if (next && isSafeRelativePath(next)) {
      sessionStorage.setItem('postLoginNext', next);
    } else {
      sessionStorage.removeItem('postLoginNext');
    }
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GOOGLE_SCOPES,
        queryParams: {
          // access_type=offline + prompt=consent forces Google to issue a
          // refresh_token that the backend can use to mint short-lived access
          // tokens for Gmail API calls.
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (err) {
      error = err.message;
      loading = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  <div class="w-full max-w-sm px-6">
    <div class="flex items-center gap-2.5 mb-1">
      <Logo size={32} class="text-accent" />
      <h1 class="font-mono text-2xl font-semibold text-text">LeadAce</h1>
    </div>
    <p class="text-text-muted text-sm mb-8">Sign in with your Google account</p>

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
      {loading ? 'Redirecting…' : 'Continue with Google'}
    </button>

    {#if error}
      <p class="text-danger text-xs mt-4">{error}</p>
    {/if}

    <p class="mt-6 text-[11px] text-text-muted">
      LeadAce will request permission to send email on your behalf via Gmail (gmail.send). We never
      read or modify your inbox; reply checking is done locally via the Gmail MCP in claude.ai.
    </p>

    <p class="mt-10 text-[11px] text-text-muted text-center">
      By continuing, you agree to the
      <a href="/terms" class="underline hover:text-text">Terms</a>
      and
      <a href="/privacy" class="underline hover:text-text">Privacy Policy</a>.
    </p>
  </div>
</div>
