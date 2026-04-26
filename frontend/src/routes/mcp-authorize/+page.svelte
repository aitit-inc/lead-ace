<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '$lib/stores/auth';
  import { supabase } from '$lib/auth';
  import Logo from '$lib/components/Logo.svelte';

  const MCP_URL = import.meta.env.VITE_MCP_URL ?? 'http://localhost:8788';

  type Status = 'loading' | 'ready' | 'submitting' | 'error';
  let status = $state<Status>('loading');
  let errorMessage = $state('');
  let clientName = $state<string | null>(null);
  let redirectUri = $state('');
  let sessionState = $state('');

  let sessionId = $derived(page.url.searchParams.get('session') ?? '');

  $effect(() => {
    if ($auth.loading) return;
    if (!$auth.session) {
      const next = `/mcp-authorize?session=${encodeURIComponent(sessionId)}`;
      goto(`/login?next=${encodeURIComponent(next)}`, { replaceState: true });
      return;
    }
    if (status !== 'loading') return;
    if (!sessionId) {
      errorMessage = 'Missing session parameter. Run /setup again to start a fresh authorization.';
      status = 'error';
      return;
    }
    void loadSessionInfo();
  });

  async function loadSessionInfo() {
    try {
      const res = await fetch(
        `${MCP_URL}/authorize/session?session=${encodeURIComponent(sessionId)}`,
      );
      if (res.status === 404) {
        throw new Error('Authorization request expired. Run /setup again to start a fresh one.');
      }
      if (!res.ok) {
        throw new Error('Failed to load authorization request.');
      }
      const data = (await res.json()) as {
        clientId: string;
        clientName: string | null;
        redirectUri: string;
        state: string;
      };
      clientName = data.clientName;
      redirectUri = data.redirectUri;
      sessionState = data.state;
      status = 'ready';
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to load authorization request.';
      status = 'error';
    }
  }

  async function handleApprove() {
    status = 'submitting';
    errorMessage = '';
    const { data } = await supabase.auth.getSession();
    const sb = data.session;
    if (!sb?.access_token || !sb.refresh_token) {
      errorMessage = 'You appear to be signed out. Please sign in and retry.';
      status = 'error';
      return;
    }
    try {
      const res = await fetch(`${MCP_URL}/authorize/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          access_token: sb.access_token,
          refresh_token: sb.refresh_token,
        }),
      });
      const body = (await res.json()) as { redirect?: string; error?: string; error_description?: string };
      if (!res.ok || !body.redirect) {
        throw new Error(body.error_description || body.error || 'Failed to authorize.');
      }
      window.location.href = body.redirect;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'Failed to authorize.';
      status = 'error';
    }
  }

  function handleDeny() {
    if (redirectUri) {
      try {
        const url = new URL(redirectUri);
        url.searchParams.set('error', 'access_denied');
        if (sessionState) url.searchParams.set('state', sessionState);
        window.location.href = url.toString();
        return;
      } catch {
        // Fall through to home navigation
      }
    }
    goto('/');
  }

  let displayClient = $derived(clientName?.trim() || 'Claude Code');
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  <div class="w-full max-w-sm px-6">
    <div class="mb-1 flex items-center gap-2.5">
      <Logo size={32} class="text-accent" />
      <h1 class="font-mono text-2xl font-semibold text-text">LeadAce</h1>
    </div>

    {#if status === 'loading'}
      <p class="mt-8 font-mono text-sm text-text-muted">Loading authorization request…</p>
    {:else if status === 'error'}
      <p class="text-text-muted text-sm mb-2">Authorization error</p>
      <p class="text-danger text-sm mb-6">{errorMessage}</p>
      <a href="/" class="text-text-muted hover:text-text text-xs underline">Back to LeadAce</a>
    {:else}
      <p class="text-text-muted text-sm mb-6">
        Authorize <span class="font-medium text-text">{displayClient}</span> to access your LeadAce account
      </p>

      <p class="text-xs text-text-muted leading-relaxed mb-6">
        Signed in as <span class="font-medium text-text">{$auth.user?.email ?? ''}</span>.
        Approving will let {displayClient} call LeadAce MCP tools on your behalf — manage prospects,
        send outreach via your connected Gmail, and read project data. You can revoke access at any
        time by signing out of {displayClient}.
      </p>

      <div class="flex flex-col gap-2">
        <button
          type="button"
          onclick={handleApprove}
          disabled={status === 'submitting'}
          class="w-full rounded-md bg-text py-2 text-sm font-medium text-page transition-colors hover:bg-text/90 disabled:opacity-50"
        >
          {status === 'submitting' ? 'Authorizing…' : `Authorize ${displayClient}`}
        </button>
        <button
          type="button"
          onclick={handleDeny}
          disabled={status === 'submitting'}
          class="w-full rounded-md border border-border bg-page py-2 text-sm font-medium text-text transition-colors hover:bg-surface disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {#if errorMessage}
        <p class="text-danger text-xs mt-4">{errorMessage}</p>
      {/if}
    {/if}
  </div>
</div>
