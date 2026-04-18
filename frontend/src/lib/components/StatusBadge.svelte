<script lang="ts">
  import type { ProspectStatus } from '$lib/types';

  let { status }: { status: ProspectStatus } = $props();

  const colors: Record<ProspectStatus, string> = {
    new: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200',
    contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    responded: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    converted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    inactive: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  };
</script>

<span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {colors[status]}">{status}</span>
