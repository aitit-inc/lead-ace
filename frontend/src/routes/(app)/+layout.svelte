<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/auth';
  import { auth } from '$lib/stores/auth';
  import { activeProject } from '$lib/stores/project';
  import ProjectSwitcher from '$lib/components/ProjectSwitcher.svelte';

  let { children } = $props();

  const nav = [
    { href: '/prospects', label: 'Prospects' },
    { href: '/outreach', label: 'Outreach' },
    { href: '/responses', label: 'Responses' },
    { href: '/evaluations', label: 'Evaluations' },
    { href: '/settings', label: 'Settings' },
  ];

  function isActive(href: string) {
    return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    activeProject.set(null);
    goto('/login');
  }
</script>

<div class="flex h-screen">
  <!-- Sidebar -->
  <aside class="flex w-48 flex-col justify-between border-r border-border bg-white px-3 py-5">
    <div>
      <h1 class="font-mono text-base font-semibold text-text mb-8 px-2">Lead Ace</h1>
      <nav class="space-y-0.5">
        {#each nav as item}
          <a
            href={item.href}
            class="block rounded px-2 py-1.5 text-sm transition-colors {isActive(item.href)
              ? 'bg-warm text-text font-medium'
              : 'text-text-secondary hover:text-text hover:bg-surface'}"
          >
            {item.label}
          </a>
        {/each}
      </nav>
    </div>
    <button
      onclick={handleLogout}
      class="px-2 py-1.5 text-left text-xs text-text-muted hover:text-text transition-colors"
    >
      Sign out
    </button>
  </aside>

  <!-- Main -->
  <div class="flex flex-1 flex-col overflow-hidden">
    <!-- Header -->
    <header class="flex items-center justify-between border-b border-border px-6 py-3">
      <ProjectSwitcher />
      <span class="text-xs text-text-muted">{$auth.user?.email ?? ''}</span>
    </header>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto px-6 py-5">
      {#if $activeProject}
        {@render children()}
      {:else}
        <div class="flex items-center justify-center h-full">
          <p class="text-text-muted text-sm">No project selected</p>
        </div>
      {/if}
    </main>
  </div>
</div>
