<script lang="ts">
  import { ApiError, del, get, post, put } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import { plan } from '$lib/stores/plan';
  import type { OutreachDraft } from '$lib/types';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  type EditState = { subject: string; body: string; saving: boolean };

  let drafts = $state<OutreachDraft[]>([]);
  let loading = $state(true);
  let expandedId = $state<number | null>(null);
  let edits = $state<Record<number, EditState>>({});
  let banner = $state<{ kind: 'info' | 'error'; text: string } | null>(null);
  let confirming = $state<{ kind: 'send' | 'discard'; draft: OutreachDraft } | null>(null);
  let busyId = $state<number | null>(null);

  $effect(() => {
    const pid = $activeProject;
    if (!pid) return;
    void loadDrafts(pid);
  });

  async function loadDrafts(pid: string) {
    loading = true;
    banner = null;
    try {
      const res = await get<{ drafts: OutreachDraft[] }>(`/projects/${pid}/drafts`);
      drafts = res.drafts;
      edits = {};
    } catch (e) {
      banner = { kind: 'error', text: e instanceof Error ? e.message : String(e) };
    } finally {
      loading = false;
    }
  }

  function toggleExpand(d: OutreachDraft) {
    if (expandedId === d.id) {
      expandedId = null;
      return;
    }
    expandedId = d.id;
    if (!edits[d.id]) {
      edits[d.id] = { subject: d.subject ?? '', body: d.body, saving: false };
    }
  }

  function isDirty(d: OutreachDraft): boolean {
    const e = edits[d.id];
    if (!e) return false;
    return (e.subject !== (d.subject ?? '')) || (e.body !== d.body);
  }

  async function saveEdits(d: OutreachDraft) {
    const e = edits[d.id];
    if (!e || !isDirty(d)) return;
    e.saving = true;
    try {
      const subject = e.subject || null;
      const body = e.body;
      await put(`/outreach/drafts/${d.id}`, { subject, body });
      drafts = drafts.map((x) => (x.id === d.id ? { ...x, subject, body } : x));
      banner = { kind: 'info', text: 'Draft saved.' };
    } catch (err) {
      banner = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
    } finally {
      e.saving = false;
    }
  }

  async function sendDraft(d: OutreachDraft) {
    busyId = d.id;
    try {
      // If the user edited but hasn't saved, persist before sending so the
      // server uses the latest body.
      if (isDirty(d)) {
        await saveEdits(d);
      }
      await post(`/outreach/drafts/${d.id}/send`, {});
      drafts = drafts.filter((x) => x.id !== d.id);
      banner = { kind: 'info', text: `Sent to ${d.prospectEmail}.` };
      void plan.load();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message}${err.detail ? ': ' + err.detail : ''}` : String(err);
      banner = { kind: 'error', text: `Send failed — ${msg}` };
    } finally {
      busyId = null;
    }
  }

  async function discardDraft(d: OutreachDraft) {
    busyId = d.id;
    try {
      await del(`/outreach/drafts/${d.id}`);
      drafts = drafts.filter((x) => x.id !== d.id);
      banner = { kind: 'info', text: 'Draft discarded.' };
    } catch (err) {
      banner = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
    } finally {
      busyId = null;
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function truncate(text: string, max = 100) {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
</script>

<h2 class="text-lg font-semibold text-text mb-1">Drafts</h2>
<p class="text-xs text-text-muted mb-4">
  Pending review from <span class="font-mono">/outbound</span> in draft mode. Send or discard each
  one. Sending counts toward your monthly outreach quota.
</p>

{#if banner}
  <div
    class="mb-4 rounded border px-3 py-2 text-xs {banner.kind === 'error'
      ? 'border-danger/40 text-danger'
      : 'border-border text-text-secondary'}"
  >
    {banner.text}
  </div>
{/if}

{#if !$activeProject}
  <p class="text-text-muted text-sm">Select a project to view its drafts.</p>
{:else if loading}
  <p class="text-text-muted text-sm">Loading…</p>
{:else if drafts.length === 0}
  <EmptyState message="No drafts pending review" />
{:else}
  <div class="space-y-2">
    {#each drafts as draft (draft.id)}
      {@const expanded = expandedId === draft.id}
      {@const e = edits[draft.id]}
      <div class="rounded border border-border">
        <button
          type="button"
          class="w-full text-left px-3 py-2.5 hover:bg-surface transition-colors"
          onclick={() => toggleExpand(draft)}
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-sm font-medium text-text truncate">{draft.prospectName}</span>
            <span class="text-[11px] text-text-muted font-mono shrink-0">
              {formatDate(draft.createdAt)}
            </span>
          </div>
          <div class="mt-0.5 flex items-baseline gap-2">
            <span class="text-[11px] text-text-muted font-mono shrink-0">
              {draft.prospectEmail ?? '(no email)'}
            </span>
            {#if draft.subject}
              <span class="text-xs text-text-secondary truncate">— {draft.subject}</span>
            {/if}
          </div>
          {#if !expanded}
            <p class="mt-1 text-xs text-text-muted line-clamp-2">{truncate(draft.body, 200)}</p>
          {/if}
        </button>

        {#if expanded && e}
          <div class="border-t border-border p-3 space-y-3">
            <div>
              <label class="block text-[11px] font-medium text-text-muted mb-1" for="subject-{draft.id}">
                Subject
              </label>
              <input
                id="subject-{draft.id}"
                type="text"
                bind:value={e.subject}
                class="w-full rounded border border-border bg-page px-2 py-1.5 text-sm text-text"
              />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-text-muted mb-1" for="body-{draft.id}">
                Body
              </label>
              <textarea
                id="body-{draft.id}"
                bind:value={e.body}
                rows="12"
                class="w-full rounded border border-border bg-page px-2 py-1.5 text-sm text-text font-mono resize-y"
              ></textarea>
            </div>
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={!isDirty(draft) || e.saving || busyId === draft.id}
                onclick={() => saveEdits(draft)}
                class="rounded border border-border bg-page px-3 py-1.5 text-xs text-text hover:bg-surface transition-colors disabled:opacity-40"
              >
                {e.saving ? 'Saving…' : 'Save edits'}
              </button>
              <button
                type="button"
                disabled={busyId === draft.id || !draft.prospectEmail}
                onclick={() => (confirming = { kind: 'send', draft })}
                class="rounded bg-text px-3 py-1.5 text-xs font-medium text-page hover:bg-text/90 transition-colors disabled:opacity-40"
              >
                {busyId === draft.id ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                disabled={busyId === draft.id}
                onclick={() => (confirming = { kind: 'discard', draft })}
                class="ml-auto rounded px-3 py-1.5 text-xs text-danger hover:bg-surface transition-colors disabled:opacity-40"
              >
                Discard
              </button>
            </div>
            {#if !draft.prospectEmail}
              <p class="text-xs text-danger">
                This prospect has no email address. Discard or update the prospect record.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if confirming}
  {@const c = confirming}
  <ConfirmDialog
    title={c.kind === 'send' ? 'Send this draft?' : 'Discard this draft?'}
    message={c.kind === 'send'
      ? `This sends the email to ${c.draft.prospectEmail} via your connected Gmail. It counts as one outreach action.`
      : 'The draft will be deleted. If this was the only outreach for the prospect, they will be available for outbound again.'}
    confirmLabel={c.kind === 'send' ? 'Send' : 'Discard'}
    danger={c.kind === 'discard'}
    onconfirm={() => {
      const action = c.kind === 'send' ? sendDraft(c.draft) : discardDraft(c.draft);
      confirming = null;
      void action;
    }}
    oncancel={() => (confirming = null)}
  />
{/if}
