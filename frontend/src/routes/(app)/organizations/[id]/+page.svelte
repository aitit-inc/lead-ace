<script lang="ts">
  import { page } from '$app/state';
  import { get, patch } from '$lib/api';
  import type { Organization, OrganizationProspect } from '$lib/types';
  import EmptyState from '$lib/components/EmptyState.svelte';

  let org = $state<Organization | null>(null);
  let orgProspects = $state<OrganizationProspect[]>([]);
  let loading = $state(true);
  let editing = $state(false);
  let editName = $state('');
  let editWebsite = $state('');
  let saveError = $state<string | null>(null);
  let saving = $state(false);

  async function load() {
    const id = page.params.id;
    if (!id) return;
    loading = true;
    const res = await get<{ organization: Organization; prospects: OrganizationProspect[] }>(
      `/organizations/${id}`,
    );
    org = res.organization;
    orgProspects = res.prospects;
    loading = false;
  }

  $effect(() => {
    void page.params.id;
    load();
  });

  function startEdit() {
    if (!org) return;
    editName = org.name;
    editWebsite = org.websiteUrl;
    saveError = null;
    editing = true;
  }

  async function saveEdit() {
    if (!org) return;
    saving = true;
    saveError = null;
    try {
      const body: { name?: string; websiteUrl?: string } = {};
      if (editName !== org.name) body.name = editName;
      if (editWebsite !== org.websiteUrl) body.websiteUrl = editWebsite;
      if (Object.keys(body).length === 0) {
        editing = false;
        saving = false;
        return;
      }
      const res = await patch<{ organization: Organization }>(`/organizations/${org.id}`, body);
      org = res.organization;
      editing = false;
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to save';
    } finally {
      saving = false;
    }
  }

  function channelLabel(p: OrganizationProspect): string {
    const parts: string[] = [];
    if (p.email) parts.push('Email');
    if (p.contactFormUrl) parts.push('Form');
    if (p.snsAccounts?.x) parts.push('X');
    if (p.snsAccounts?.linkedin) parts.push('LI');
    return parts.join(', ') || '-';
  }
</script>

<div class="mb-4">
  <a href="/organizations" class="text-xs text-text-muted hover:text-text">← Organizations</a>
</div>

{#if loading}
  <p class="text-text-muted text-sm">Loading...</p>
{:else if !org}
  <EmptyState message="Organization not found" />
{:else}
  <div class="mb-6 rounded bg-surface px-4 py-4">
    {#if !editing}
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="text-lg font-semibold text-text">{org.name}</h2>
          <p class="text-xs text-text-muted font-mono mt-1">{org.domain}</p>
          <p class="text-xs mt-2">
            <span class="text-text-muted">Website:</span>
            <a href={org.websiteUrl} target="_blank" class="text-accent hover:underline break-all ml-1">{org.websiteUrl}</a>
          </p>
        </div>
        <button
          onclick={startEdit}
          class="shrink-0 rounded bg-surface-2 px-3 py-1 text-xs text-text hover:bg-surface-2/80 transition-colors"
        >
          Edit
        </button>
      </div>
    {:else}
      <div class="space-y-3">
        <div>
          <label for="org-name" class="block text-xs text-text-muted mb-1">Name</label>
          <input
            id="org-name"
            type="text"
            bind:value={editName}
            class="w-full bg-page rounded px-3 py-1.5 text-sm text-text outline-none"
          />
        </div>
        <div>
          <label for="org-website" class="block text-xs text-text-muted mb-1">Website URL</label>
          <input
            id="org-website"
            type="url"
            bind:value={editWebsite}
            class="w-full bg-page rounded px-3 py-1.5 text-sm text-text outline-none"
          />
        </div>
        <p class="text-[11px] text-text-muted">Domain ({org.domain}) is the dedup key and cannot be changed.</p>
        {#if saveError}
          <p class="text-xs text-danger">{saveError}</p>
        {/if}
        <div class="flex gap-2">
          <button
            onclick={saveEdit}
            disabled={saving}
            class="rounded bg-text px-3 py-1.5 text-xs font-medium text-page hover:bg-text/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onclick={() => (editing = false)}
            disabled={saving}
            class="rounded bg-surface-2 px-3 py-1.5 text-xs text-text hover:bg-surface-2/80 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>

  <div class="mb-4 flex items-center justify-between">
    <h3 class="text-sm font-semibold text-text">Prospects ({orgProspects.length})</h3>
  </div>

  {#if orgProspects.length === 0}
    <EmptyState message="No prospects under this organization yet." />
  {:else}
    <div class="space-y-0">
      <div class="hidden md:grid grid-cols-[1.5fr_140px_70px_60px_100px] gap-4 px-3 py-2 text-xs font-medium text-text-muted">
        <span>Name</span>
        <span>Channels</span>
        <span class="text-center">Proj.</span>
        <span class="text-center">DNC</span>
        <span class="text-right">Added</span>
      </div>

      {#each orgProspects as p}
        <div class="hidden md:grid grid-cols-[1.5fr_140px_70px_60px_100px] gap-4 px-3 py-2.5 text-sm hover:bg-surface transition-colors rounded">
          <div class="min-w-0">
            <p class="text-text truncate">{p.name}</p>
            {#if p.department}<p class="text-xs text-text-muted truncate">{p.department}</p>{/if}
          </div>
          <span class="text-xs text-text-secondary self-center">{channelLabel(p)}</span>
          <span class="text-center text-xs font-mono text-text-secondary self-center">{p.projectCount}</span>
          <span class="text-center text-xs self-center">
            {#if p.doNotContact}<span class="text-danger font-medium">Yes</span>{:else}-{/if}
          </span>
          <span class="text-right text-xs font-mono text-text-muted self-center">
            {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>

        <div class="flex md:hidden flex-col gap-1 px-3 py-3 rounded hover:bg-surface transition-colors">
          <div class="flex items-start justify-between gap-2">
            <p class="min-w-0 flex-1 truncate text-sm text-text">{p.name}</p>
            {#if p.doNotContact}<span class="shrink-0 text-[11px] text-danger font-medium">DNC</span>{/if}
          </div>
          {#if p.department}<p class="text-xs text-text-muted truncate">{p.department}</p>{/if}
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-text-muted">
            <span>{channelLabel(p)}</span>
            <span aria-hidden="true">·</span>
            <span>{p.projectCount} projects</span>
            <span aria-hidden="true">·</span>
            <span>{new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}
