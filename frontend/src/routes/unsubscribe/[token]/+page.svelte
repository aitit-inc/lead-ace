<script lang="ts">
  import { page } from '$app/state';
  import Logo from '$lib/components/Logo.svelte';

  const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

  type LoadState =
    | { kind: 'loading' }
    | { kind: 'ready'; email: string; organizationName: string; alreadyUnsubscribed: boolean }
    | { kind: 'invalid'; message: string }
    | { kind: 'done' };

  let view = $state<LoadState>({ kind: 'loading' });
  let submitting = $state(false);

  $effect(() => {
    const token = page.params.token;
    if (!token) return;
    void load(token);
  });

  async function load(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/unsubscribe/${encodeURIComponent(token)}`);
      const data = (await res.json().catch(() => ({}))) as {
        email?: string;
        organizationName?: string;
        alreadyUnsubscribed?: boolean;
        error?: string;
      };
      if (!res.ok) {
        view = {
          kind: 'invalid',
          message: data.error ?? `Request failed (${res.status})`,
        };
        return;
      }
      view = {
        kind: 'ready',
        email: data.email ?? '',
        organizationName: data.organizationName ?? '',
        alreadyUnsubscribed: data.alreadyUnsubscribed ?? false,
      };
    } catch (e) {
      view = {
        kind: 'invalid',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async function confirm() {
    const token = page.params.token;
    if (!token || submitting) return;
    submitting = true;
    try {
      const res = await fetch(`${API_BASE}/api/unsubscribe/${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        view = {
          kind: 'invalid',
          message: data.error ?? `Request failed (${res.status})`,
        };
        return;
      }
      view = { kind: 'done' };
    } catch (e) {
      view = {
        kind: 'invalid',
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Unsubscribe · LeadAce</title>
</svelte:head>

<div class="mx-auto max-w-md px-6 py-12">
  <a href="/" class="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
    <Logo size={14} class="text-accent" />
    ← LeadAce
  </a>
  <h1 class="mt-4 text-2xl font-semibold text-text">Unsubscribe</h1>

  <div class="mt-8 text-sm leading-relaxed text-text-secondary">
    {#if view.kind === 'loading'}
      <p class="text-text-muted">Loading…</p>
    {:else if view.kind === 'invalid'}
      <p class="text-danger">{view.message}</p>
      <p class="mt-3 text-xs text-text-muted">
        If you got here from one of our emails and the link is broken, reply to that email
        and we'll remove you manually.
      </p>
    {:else if view.kind === 'done'}
      <p>You've been unsubscribed. We won't send you any more outreach emails.</p>
    {:else if view.kind === 'ready' && view.alreadyUnsubscribed}
      <p>
        <span class="font-mono">{view.email}</span> is already unsubscribed from
        {view.organizationName ? view.organizationName : 'this sender'}. No further action
        needed.
      </p>
    {:else if view.kind === 'ready'}
      <p>
        Click below to unsubscribe <span class="font-mono">{view.email}</span> from
        {view.organizationName ? view.organizationName : 'this sender'}. We won't send you any
        more outreach emails.
      </p>
      <div class="mt-6 flex gap-2">
        <button
          type="button"
          disabled={submitting}
          onclick={confirm}
          class="rounded bg-text px-4 py-2 text-xs font-medium text-page hover:bg-text/90 transition-colors disabled:opacity-40"
        >
          {submitting ? 'Unsubscribing…' : 'Unsubscribe'}
        </button>
      </div>
    {/if}
  </div>
</div>
