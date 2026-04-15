<script lang="ts">
  import type { ProspectStatus } from '$lib/types';

  let { status }: { status: ProspectStatus } = $props();

  const colors: Record<ProspectStatus, string> = {
    new: 'bg-neutral-200 text-neutral-600',
    contacted: 'bg-blue-100 text-blue-700',
    responded: 'bg-green-100 text-green-700',
    converted: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    inactive: 'bg-amber-100 text-amber-700',
    unreachable: 'bg-neutral-300 text-neutral-600',
  };
</script>

<span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {colors[status]}">{status}</span>
