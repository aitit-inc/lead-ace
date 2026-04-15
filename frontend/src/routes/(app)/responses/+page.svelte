<script lang="ts">
  import { get } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import type { ResponseRecord, Sentiment, ResponseType } from '$lib/types';
  import ChannelBadge from '$lib/components/ChannelBadge.svelte';
  import SentimentBadge from '$lib/components/SentimentBadge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  const sentiments: Sentiment[] = ['positive', 'neutral', 'negative'];
  const responseTypes: ResponseType[] = ['reply', 'auto_reply', 'bounce', 'meeting_request', 'rejection'];

  let responses = $state<ResponseRecord[]>([]);
  let loading = $state(true);
  let filterSentiment = $state('');
  let filterType = $state('');
  let expandedId = $state<number | null>(null);

  $effect(() => {
    const pid = $activeProject;
    if (!pid) return;
    loading = true;
    const params = new URLSearchParams({ limit: '200' });
    if (filterSentiment) params.set('sentiment', filterSentiment);
    if (filterType) params.set('responseType', filterType);
    get<{ responses: ResponseRecord[] }>(`/projects/${pid}/responses?${params}`).then((res) => {
      responses = res.responses;
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

  function truncate(text: string, max = 100) {
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  function formatType(t: ResponseType): string {
    return t.replace(/_/g, ' ');
  }
</script>

<h2 class="text-lg font-semibold text-text mb-4">Responses</h2>

<!-- Filters -->
<div class="flex gap-4 mb-4">
  <select bind:value={filterSentiment} class="bg-surface rounded px-2 py-1 text-xs text-text outline-none">
    <option value="">All sentiments</option>
    {#each sentiments as s}
      <option value={s}>{s}</option>
    {/each}
  </select>
  <select bind:value={filterType} class="bg-surface rounded px-2 py-1 text-xs text-text outline-none">
    <option value="">All types</option>
    {#each responseTypes as t}
      <option value={t}>{formatType(t)}</option>
    {/each}
  </select>
</div>

{#if loading}
  <p class="text-text-muted text-sm">Loading...</p>
{:else if responses.length === 0}
  <EmptyState message="No responses yet" />
{:else}
  <div class="space-y-0">
    <div class="grid grid-cols-[120px_70px_1fr_80px_100px] gap-4 px-3 py-2 text-xs font-medium text-text-muted">
      <span>Date</span>
      <span>Channel</span>
      <span>Prospect / Content</span>
      <span>Sentiment</span>
      <span>Type</span>
    </div>

    {#each responses as r}
      <button
        class="grid w-full grid-cols-[120px_70px_1fr_80px_100px] gap-4 px-3 py-2.5 text-left text-sm hover:bg-surface transition-colors rounded"
        onclick={() => (expandedId = expandedId === r.id ? null : r.id)}
      >
        <span class="text-text-secondary text-xs font-mono">{formatDate(r.receivedAt)}</span>
        <span><ChannelBadge channel={r.channel} /></span>
        <div class="min-w-0">
          <p class="text-xs text-text-muted truncate">
            {r.prospectName}
            {#if r.outreachSubject}&mdash; re: {r.outreachSubject}{/if}
          </p>
          <p class="text-text truncate">{truncate(r.content)}</p>
        </div>
        <span class="self-center"><SentimentBadge sentiment={r.sentiment} /></span>
        <span class="text-xs text-text-secondary self-center">{formatType(r.responseType)}</span>
      </button>

      {#if expandedId === r.id}
        <div class="mx-3 mb-2 rounded bg-surface px-4 py-3">
          <p class="text-xs text-text whitespace-pre-wrap">{r.content}</p>
        </div>
      {/if}
    {/each}
  </div>
{/if}
