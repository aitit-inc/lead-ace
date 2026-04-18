<script lang="ts">
  import { get } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import type { OutreachLog } from '$lib/types';
  import ChannelBadge from '$lib/components/ChannelBadge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  let logs = $state<OutreachLog[]>([]);
  let loading = $state(true);
  let expandedId = $state<number | null>(null);

  $effect(() => {
    const pid = $activeProject;
    if (!pid) return;
    loading = true;
    get<{ logs: OutreachLog[] }>(`/projects/${pid}/outreach/recent?limit=200`).then((res) => {
      logs = res.logs;
      loading = false;
    });
  });

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function truncate(text: string, max = 80) {
    return text.length > max ? text.slice(0, max) + '...' : text;
  }
</script>

<h2 class="text-lg font-semibold text-text mb-4">Outreach Logs</h2>

{#if loading}
  <p class="text-text-muted text-sm">Loading...</p>
{:else if logs.length === 0}
  <EmptyState message="No outreach logs yet" />
{:else}
  <div class="space-y-0">
    <!-- Header (desktop only) -->
    <div class="hidden md:grid grid-cols-[120px_70px_60px_1fr_60px] gap-4 px-3 py-2 text-xs font-medium text-text-muted">
      <span>Date</span>
      <span>Channel</span>
      <span>Status</span>
      <span>Subject / Body</span>
      <span class="text-right">ID</span>
    </div>

    {#each logs as log}
      <!-- Desktop row -->
      <button
        class="hidden md:grid w-full grid-cols-[120px_70px_60px_1fr_60px] gap-4 px-3 py-2.5 text-left text-sm hover:bg-surface transition-colors rounded"
        onclick={() => (expandedId = expandedId === log.id ? null : log.id)}
      >
        <span class="text-text-secondary text-xs font-mono">{formatDate(log.sentAt)}</span>
        <span><ChannelBadge channel={log.channel} /></span>
        <span>
          <span
            class="inline-block h-1.5 w-1.5 rounded-full {log.status === 'sent'
              ? 'bg-green-500'
              : 'bg-red-500'}"
          ></span>
          <span class="text-xs text-text-secondary ml-1">{log.status}</span>
        </span>
        <span class="text-text truncate">
          {#if log.subject}
            <span class="font-medium">{log.subject}</span> &mdash;
          {/if}
          {truncate(log.body)}
        </span>
        <span class="text-right text-xs text-text-muted font-mono">#{log.prospectId}</span>
      </button>

      <!-- Mobile card -->
      <button
        class="flex md:hidden w-full flex-col gap-1 px-3 py-3 text-left hover:bg-surface transition-colors rounded"
        onclick={() => (expandedId = expandedId === log.id ? null : log.id)}
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <ChannelBadge channel={log.channel} />
            <span class="text-[11px] text-text-muted font-mono truncate">{formatDate(log.sentAt)}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <span
              class="inline-block h-1.5 w-1.5 rounded-full {log.status === 'sent'
                ? 'bg-green-500'
                : 'bg-red-500'}"
            ></span>
            <span class="text-[11px] text-text-secondary">{log.status}</span>
          </div>
        </div>
        {#if log.subject}
          <p class="text-sm font-medium text-text truncate">{log.subject}</p>
        {/if}
        <p class="text-xs text-text-secondary line-clamp-2">{truncate(log.body, 120)}</p>
        <span class="text-[11px] text-text-muted font-mono">#{log.prospectId}</span>
      </button>

      {#if expandedId === log.id}
        <div class="mx-3 mb-2 rounded bg-surface px-4 py-3">
          {#if log.subject}
            <p class="text-xs font-medium text-text mb-1 break-words">{log.subject}</p>
          {/if}
          <p class="text-xs text-text-secondary whitespace-pre-wrap break-words">{log.body}</p>
          {#if log.errorMessage}
            <p class="text-xs text-accent mt-2 break-words">Error: {log.errorMessage}</p>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}
