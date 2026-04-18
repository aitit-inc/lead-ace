<script lang="ts">
  import { get } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import type { ProjectStats, Evaluation } from '$lib/types';
  import EmptyState from '$lib/components/EmptyState.svelte';

  let stats = $state<ProjectStats | null>(null);
  let evaluations = $state<Evaluation[]>([]);
  let loading = $state(true);

  $effect(() => {
    const pid = $activeProject;
    if (!pid) return;
    loading = true;
    Promise.all([
      get<ProjectStats>(`/projects/${pid}/stats`),
      get<{ evaluations: Evaluation[] }>(`/projects/${pid}/evaluations`),
    ]).then(([s, e]) => {
      stats = s;
      evaluations = e.evaluations;
      loading = false;
    });
  });

  function pct(n: number, d: number) {
    if (d === 0) return '0%';
    return (n / d * 100).toFixed(1) + '%';
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
</script>

<h2 class="text-lg font-semibold text-text mb-6">Evaluations</h2>

{#if loading}
  <p class="text-text-muted text-sm">Loading...</p>
{:else if !stats}
  <EmptyState message="No data available" />
{:else}
  <!-- KPI Summary -->
  <section class="mb-10">
    <h3 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Current Metrics</h3>

    <!-- Top numbers -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-6">
      <div>
        <p class="text-2xl font-mono font-semibold text-text">{stats.metrics.totalOutreach}</p>
        <p class="text-xs text-text-muted mt-0.5">Total outreach</p>
      </div>
      <div>
        <p class="text-2xl font-mono font-semibold text-text">{stats.metrics.responseCounts.totalResponses}</p>
        <p class="text-xs text-text-muted mt-0.5">Responses</p>
      </div>
      <div>
        <p class="text-2xl font-mono font-semibold text-text">
          {pct(stats.metrics.responseCounts.totalResponses, stats.metrics.totalOutreach)}
        </p>
        <p class="text-xs text-text-muted mt-0.5">Response rate</p>
      </div>
      <div>
        <p class="text-2xl font-mono font-semibold {stats.dataSufficiency.sufficient ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}">
          {stats.dataSufficiency.sufficient ? 'Yes' : 'No'}
        </p>
        <p class="text-xs text-text-muted mt-0.5">Data sufficient</p>
      </div>
    </div>

    <!-- Channel performance -->
    {#if stats.metrics.channelResponseRate.length > 0}
      <div class="mb-6">
        <p class="text-xs font-medium text-text-secondary mb-2">By channel</p>
        <div class="grid grid-cols-[1fr_60px_70px_60px] md:grid-cols-[1fr_80px_80px_80px] gap-2 text-xs">
          <span class="text-text-muted">Channel</span>
          <span class="text-text-muted text-right">Sent</span>
          <span class="text-text-muted text-right">Resp.</span>
          <span class="text-text-muted text-right">Rate</span>
          {#each stats.metrics.channelResponseRate as ch}
            <span class="text-text font-mono truncate">{ch.channel}</span>
            <span class="text-text-secondary text-right font-mono">{ch.total}</span>
            <span class="text-text-secondary text-right font-mono">{ch.responses}</span>
            <span class="text-text text-right font-mono">{pct(ch.responses, ch.total)}</span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Priority performance -->
    {#if stats.metrics.priorityResponseRate.length > 0}
      <div class="mb-6">
        <p class="text-xs font-medium text-text-secondary mb-2">By priority</p>
        <div class="grid grid-cols-[1fr_60px_70px_60px] md:grid-cols-[1fr_80px_80px_80px] gap-2 text-xs">
          <span class="text-text-muted">Priority</span>
          <span class="text-text-muted text-right">Sent</span>
          <span class="text-text-muted text-right">Resp.</span>
          <span class="text-text-muted text-right">Rate</span>
          {#each stats.metrics.priorityResponseRate as pr}
            <span class="text-text font-mono">P{pr.priority}</span>
            <span class="text-text-secondary text-right font-mono">{pr.total}</span>
            <span class="text-text-secondary text-right font-mono">{pr.responses}</span>
            <span class="text-text text-right font-mono">{pct(pr.responses, pr.total)}</span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Sentiment breakdown -->
    {#if stats.metrics.sentimentBreakdown.length > 0}
      <div>
        <p class="text-xs font-medium text-text-secondary mb-2">Sentiment breakdown</p>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {#each stats.metrics.sentimentBreakdown as s}
            <span class="font-mono">
              <span class="text-text-muted">{s.sentiment}/{s.responseType}:</span>
              <span class="text-text font-medium">{s.count}</span>
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <!-- Evaluation History -->
  <section>
    <h3 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">History</h3>

    {#if evaluations.length === 0}
      <EmptyState message="No evaluations recorded yet" />
    {:else}
      <div class="space-y-6">
        {#each evaluations as ev}
          <div class="border-l-2 border-warm-dark pl-4">
            <p class="text-xs font-mono text-text-muted mb-2">{formatDate(ev.evaluationDate)}</p>
            <div class="space-y-2">
              <div>
                <p class="text-xs font-medium text-text-secondary mb-0.5">Findings</p>
                <p class="text-sm text-text whitespace-pre-wrap">{ev.findings}</p>
              </div>
              <div>
                <p class="text-xs font-medium text-text-secondary mb-0.5">Improvements</p>
                <p class="text-sm text-text whitespace-pre-wrap">{ev.improvements}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}
