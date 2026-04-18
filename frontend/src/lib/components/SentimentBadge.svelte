<script lang="ts">
  import type { Sentiment } from '$lib/types';

  let { sentiment }: { sentiment: Sentiment } = $props();

  const colors: Record<Sentiment, string> = {
    positive: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    neutral: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200',
    negative: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  };
</script>

<span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {colors[sentiment]}">{sentiment}</span>
