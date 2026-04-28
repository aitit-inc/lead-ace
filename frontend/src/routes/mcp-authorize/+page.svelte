<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '$lib/stores/auth';
  import { supabase } from '$lib/auth';
  import { MCP_BASE } from '$lib/api';
  import Logo from '$lib/components/Logo.svelte';

  type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'error';
  let status = $state<Status>('loading');
  let errorMessage = $state('');
  let clientName = $state<string | null>(null);
  let redirectUri = $state('');
  let sessionState = $state('');
  let finalRedirect = $state('');
  let copied = $state(false);

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
        `${MCP_BASE}/authorize/session?session=${encodeURIComponent(sessionId)}`,
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
    if (!sb?.access_token) {
      errorMessage = 'You appear to be signed out. Please sign in and retry.';
      status = 'error';
      return;
    }
    try {
      const res = await fetch(`${MCP_BASE}/authorize/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          access_token: sb.access_token,
        }),
      });
      const body = (await res.json()) as { redirect?: string; error?: string; error_description?: string };
      if (!res.ok || !body.redirect) {
        throw new Error(body.error_description || body.error || 'Failed to authorize.');
      }
      finalRedirect = body.redirect;
      status = 'success';
      // Auto-navigate after a short pause so the user can see the success
      // screen and copy the URL if Claude Code's loopback handler doesn't
      // catch it (e.g. when the CLI prompts for a manual paste fallback).
      setTimeout(() => {
        window.location.href = finalRedirect;
      }, 1500);
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
      } catch { /* invalid redirect_uri — go home below */ }
    }
    goto('/');
  }

  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(finalRedirect);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard API unavailable — user can still select & copy manually.
    }
  }

  $effect(() => () => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

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
    {:else if status === 'success'}
      <p class="text-text-muted text-sm mb-2">Authorized</p>
      <p class="text-text text-sm mb-4">
        {displayClient} has access to your LeadAce account.
      </p>
      <p class="text-xs text-text-muted leading-relaxed mb-3">
        Returning you to {displayClient}. You can close this tab once your terminal resumes.
      </p>
      <p class="text-xs text-text-muted leading-relaxed mb-2">
        If your terminal is waiting for a URL instead of resuming automatically, copy this and
        paste it back into the terminal:
      </p>
      <div class="flex items-center gap-2 mb-2">
        <input
          type="text"
          readonly
          value={finalRedirect}
          class="flex-1 min-w-0 rounded border border-border bg-surface px-2 py-1 font-mono text-[11px] text-text"
          onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
        <button
          type="button"
          onclick={copyRedirect}
          class="shrink-0 rounded border border-border bg-page px-2 py-1 text-[11px] text-text hover:bg-surface"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <a
        href={finalRedirect}
        class="block text-xs text-text-muted hover:text-text underline"
      >
        Or click here to return now
      </a>
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
