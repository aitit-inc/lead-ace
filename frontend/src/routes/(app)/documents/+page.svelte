<script lang="ts">
  import { get } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import type { DocumentSummary, DocumentVersion } from '$lib/types';
  import EmptyState from '$lib/components/EmptyState.svelte';

  const SLUG_LABELS: Record<string, string> = {
    business: 'Business',
    sales_strategy: 'Sales Strategy',
    search_notes: 'Search Notes',
  };

  let documents = $state<DocumentSummary[]>([]);
  let loading = $state(true);

  // Selected document state
  let selectedSlug = $state<string | null>(null);
  let currentDoc = $state<DocumentVersion | null>(null);
  let history = $state<DocumentVersion[]>([]);
  let showHistory = $state(false);
  let loadingDoc = $state(false);

  $effect(() => {
    const pid = $activeProject;
    if (!pid) return;
    loading = true;
    selectedSlug = null;
    currentDoc = null;
    history = [];
    get<{ documents: DocumentSummary[] }>(`/projects/${pid}/documents`).then((res) => {
      documents = res.documents;
      loading = false;
    });
  });

  async function selectDoc(slug: string) {
    const pid = $activeProject;
    if (!pid) return;
    selectedSlug = slug;
    loadingDoc = true;
    showHistory = false;
    history = [];
    try {
      currentDoc = await get<DocumentVersion>(`/projects/${pid}/documents/${slug}`);
    } catch {
      currentDoc = null;
    }
    loadingDoc = false;
  }

  async function loadHistory() {
    const pid = $activeProject;
    if (!pid || !selectedSlug) return;
    showHistory = true;
    const res = await get<{ history: DocumentVersion[] }>(
      `/projects/${pid}/documents/${selectedSlug}/history?limit=20`,
    );
    history = res.history;
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function label(slug: string) {
    return SLUG_LABELS[slug] ?? slug;
  }
</script>

<h2 class="text-lg font-semibold text-text mb-6">Documents</h2>

{#if loading}
  <p class="text-text-muted text-sm">Loading...</p>
{:else if documents.length === 0}
  <EmptyState message="No documents yet. Run /strategy to create business and strategy documents." />
{:else}
  <div class="flex flex-col md:flex-row gap-4 md:gap-6">
    <!-- Document list (horizontal chips on mobile, vertical list on desktop) -->
    <div class="md:w-48 md:shrink-0">
      <div class="flex flex-wrap gap-2 md:flex-col md:gap-1">
        {#each documents as doc}
          <button
            onclick={() => selectDoc(doc.slug)}
            class="text-left px-3 py-2 rounded text-sm transition-colors md:w-full
              {selectedSlug === doc.slug
                ? 'bg-warm text-text font-medium'
                : 'text-text-secondary hover:text-text hover:bg-surface'}"
          >
            <span class="block">{label(doc.slug)}</span>
            <span class="block text-xs text-text-muted mt-0.5">{formatDate(doc.updatedAt)}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Document content -->
    <div class="flex-1 min-w-0">
      {#if !selectedSlug}
        <p class="text-text-muted text-sm">Select a document to view</p>
      {:else if loadingDoc}
        <p class="text-text-muted text-sm">Loading...</p>
      {:else if !currentDoc}
        <EmptyState message="Document not found" />
      {:else}
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h3 class="text-base font-semibold text-text">{label(selectedSlug)}</h3>
            <p class="text-xs text-text-muted mt-0.5">Last updated: {formatDate(currentDoc.createdAt)}</p>
          </div>
          <button
            onclick={loadHistory}
            class="text-xs text-accent hover:underline"
          >
            {showHistory ? 'Hide history' : 'Show history'}
          </button>
        </div>

        <div class="rounded border border-border bg-page p-4 overflow-x-auto">
          <pre class="text-sm text-text whitespace-pre-wrap font-mono leading-relaxed">{currentDoc.content}</pre>
        </div>

        {#if showHistory && history.length > 0}
          <div class="mt-6">
            <h4 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
              Version History ({history.length})
            </h4>
            <div class="space-y-3">
              {#each history as ver, i}
                <details class="border border-border rounded">
                  <summary class="px-3 py-2 text-xs cursor-pointer hover:bg-surface transition-colors">
                    <span class="font-mono text-text-muted">{formatDate(ver.createdAt)}</span>
                    {#if i === 0}
                      <span class="ml-2 text-accent font-medium">current</span>
                    {/if}
                  </summary>
                  <div class="px-3 py-2 border-t border-border bg-surface">
                    <pre class="text-xs text-text whitespace-pre-wrap font-mono leading-relaxed">{ver.content}</pre>
                  </div>
                </details>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
