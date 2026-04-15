<script lang="ts">
  import type { Sentiment } from '$lib/types';

  let { sentiment }: { sentiment: Sentiment } = $props();

  const colors: Record<Sentiment, string> = {
    positive: 'bg-green-100 text-green-700',
    neutral: 'bg-neutral-200 text-neutral-600',
    negative: 'bg-red-100 text-red-700',
  };
</script>

<span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {colors[sentiment]}">{sentiment}</span>
