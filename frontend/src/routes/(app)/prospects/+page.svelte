<script lang="ts">
  import { get } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import { channelLabel } from '$lib/contact-channels';
  import type { Prospect, ProspectStatus } from '$lib/types';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  const statuses: ProspectStatus[] = ['new', 'contacted', 'responded', 'converted', 'rejected', 'inactive'];

  let prospects = $state<Prospect[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let filterStatus = $state('');
  let filterPriority = $state('');
  let expandedId = $state<number | null>(null);

  async function load() {
    const pid = $activeProject;
    if (!pid) return;
    loading = true;
    const params = new URLSearchParams({ limit: '500' });
    if (filterStatus) params.set('status', filterStatus);
    if (filterPriority) params.set('priority', filterPriority);
    const res = await get<{ prospects: Prospect[]; total: number }>(
      `/projects/${pid}/prospects?${params}`,
    );
    prospects = res.prospects;
    total = res.total;
    loading = false;
  }

  // Reload when project or filters change
  $effect(() => {
    void $activeProject;
    void filterStatus;
    void filterPriority;
    load();
  });
</script>

<div class="flex items-center justify-between mb-4">
  <h2 class="text-lg font-semibold text-text">Prospects</h2>
  <span class="text-xs text-text-muted font-mono">{total} total</span>
</div>

<!-- Filters -->
<div class="flex gap-4 mb-4">
  <select bind:value={filterStatus} class="bg-surface rounded px-2 py-1 text-xs text-text outline-none">
    <option value="">All statuses</option>
    {#each statuses as s}
      <option value={s}>{s}</option>
    {/each}
  </select>
  <select bind:value={filterPriority} class="bg-surface rounded px-2 py-1 text-xs text-text outline-none">
    <option value="">All priorities</option>
    {#each [1, 2, 3, 4, 5] as p}
      <option value={p}>P{p}</option>
    {/each}
  </select>
</div>

{#if loading}
  <p class="text-text-muted text-sm">Loading...</p>
{:else if prospects.length === 0}
  <EmptyState message="No prospects found" />
{:else}
  <div class="space-y-0">
    <!-- Header (desktop only) -->
    <div class="hidden md:grid grid-cols-[1fr_140px_70px_50px_100px] gap-4 px-3 py-2 text-xs font-medium text-text-muted">
      <span>Name / Organization</span>
      <span>Channels</span>
      <span>Status</span>
      <span class="text-center">Pri</span>
      <span class="text-right">Added</span>
    </div>

    {#each prospects as p}
      <!-- Desktop row -->
      <button
        class="hidden md:grid w-full grid-cols-[1fr_140px_70px_50px_100px] gap-4 px-3 py-2.5 text-left text-sm hover:bg-surface transition-colors rounded"
        onclick={() => (expandedId = expandedId === p.ppId ? null : p.ppId)}
      >
        <div class="min-w-0">
          <p class="text-text truncate">{p.name}</p>
          <p class="text-xs text-text-muted truncate">{p.organizationName}</p>
        </div>
        <span class="text-xs text-text-secondary self-center">{channelLabel(p)}</span>
        <span class="self-center"><StatusBadge status={p.status} /></span>
        <span class="text-center text-xs font-mono text-text-secondary self-center">P{p.priority}</span>
        <span class="text-right text-xs font-mono text-text-muted self-center">
          {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </button>

      <!-- Mobile card -->
      <button
        class="flex md:hidden w-full flex-col gap-1 px-3 py-3 text-left hover:bg-surface transition-colors rounded"
        onclick={() => (expandedId = expandedId === p.ppId ? null : p.ppId)}
      >
        <div class="flex items-start justify-between gap-2">
          <p class="min-w-0 flex-1 truncate text-sm text-text">{p.name}</p>
          <span class="shrink-0"><StatusBadge status={p.status} /></span>
        </div>
        <p class="text-xs text-text-muted truncate">{p.organizationName}</p>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-text-muted">
          <span>{channelLabel(p)}</span>
          <span aria-hidden="true">·</span>
          <span>P{p.priority}</span>
          <span aria-hidden="true">·</span>
          <span>{new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        </div>
      </button>

      {#if expandedId === p.ppId}
        <div class="mx-3 mb-2 rounded bg-surface px-4 py-3 text-xs space-y-1.5">
          <p><span class="text-text-muted">Organization:</span> <a href="/organizations/{p.organizationId}" class="text-accent hover:underline">{p.organizationName}</a></p>
          <p class="break-words"><span class="text-text-muted">Website:</span> <a href={p.websiteUrl} target="_blank" class="text-accent hover:underline">{p.websiteUrl}</a></p>
          {#if p.email}<p class="break-all"><span class="text-text-muted">Email:</span> <span class="font-mono">{p.email}</span></p>{/if}
          {#if p.contactFormUrl}<p class="break-all"><span class="text-text-muted">Form:</span> <a href={p.contactFormUrl} target="_blank" class="text-accent hover:underline">{p.contactFormUrl}</a></p>{/if}
          {#if p.contactName}<p><span class="text-text-muted">Contact:</span> {p.contactName}{#if p.overview} &mdash; {p.overview}{/if}</p>{/if}
          <p><span class="text-text-muted">Match reason:</span> {p.matchReason}</p>
          {#if p.notes}<p><span class="text-text-muted">Notes:</span> {p.notes}</p>{/if}
          {#if p.doNotContact}<p class="text-danger font-medium">Do not contact</p>{/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}
