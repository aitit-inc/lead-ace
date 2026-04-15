<script lang="ts">
  import type { Channel } from '$lib/types';

  let { channel }: { channel: Channel } = $props();

  const labels: Record<Channel, string> = {
    email: 'Email',
    form: 'Form',
    sns_twitter: 'X',
    sns_linkedin: 'LinkedIn',
  };

  const colors: Record<Channel, string> = {
    email: 'bg-blue-100 text-blue-700',
    form: 'bg-purple-100 text-purple-700',
    sns_twitter: 'bg-sky-100 text-sky-700',
    sns_linkedin: 'bg-indigo-100 text-indigo-700',
  };
</script>

<span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium {colors[channel]}">{labels[channel]}</span>
