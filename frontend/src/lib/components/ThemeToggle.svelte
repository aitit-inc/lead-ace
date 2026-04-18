<script lang="ts">
  import { theme, type ThemeChoice } from '$lib/stores/theme';

  const options: { value: ThemeChoice; label: string; icon: string }[] = [
    {
      value: 'system',
      label: 'System',
      icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.4-6.4l-.7.7M5.3 18.7l-.7.7m14.1 0l-.7-.7M5.3 5.3l-.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    },
    {
      value: 'light',
      label: 'Light',
      icon: 'M12 3v1m0 16v1m8-9h1M3 12h1m14.3-6.3l-.7.7M5.4 18.6l-.7.7m13.6 0l-.7-.7M5.4 5.4l-.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    },
  ];
</script>

<div
  class="inline-flex rounded border border-border bg-surface p-0.5 text-text-muted"
  role="group"
  aria-label="Theme"
>
  {#each options as opt}
    <button
      type="button"
      onclick={() => theme.setChoice(opt.value)}
      aria-pressed={$theme === opt.value}
      title={opt.label}
      class="flex items-center justify-center rounded px-1.5 py-0.5 transition-colors {$theme ===
      opt.value
        ? 'bg-page text-text shadow-sm'
        : 'hover:text-text'}"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={opt.icon} />
      </svg>
      <span class="sr-only">{opt.label}</span>
    </button>
  {/each}
</div>
