<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/auth';
  import { auth } from '$lib/stores/auth';
  import { activeProject } from '$lib/stores/project';
  import { plan } from '$lib/stores/plan';
  import ProjectSwitcher from '$lib/components/ProjectSwitcher.svelte';
  import ProjectCreateDialog from '$lib/components/ProjectCreateDialog.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import Logo from '$lib/components/Logo.svelte';

  let { children } = $props();
  let showCreate = $state(false);
  let drawerOpen = $state(false);

  onMount(() => {
    plan.load();
  });

  const nav = [
    { href: '/prospects', label: 'Prospects' },
    { href: '/outreach', label: 'Outreach' },
    { href: '/responses', label: 'Responses' },
    { href: '/evaluations', label: 'Evaluations' },
    { href: '/documents', label: 'Documents' },
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

  // Close drawer on route change so nav taps dismiss the overlay automatically.
  $effect(() => {
    void page.url.pathname;
    drawerOpen = false;
  });
</script>

<div class="flex h-screen">
  <!-- Drawer backdrop (mobile only, visible when open) -->
  {#if drawerOpen}
    <button
      type="button"
      class="fixed inset-0 z-20 bg-black/40 md:hidden"
      aria-label="Close menu"
      onclick={() => (drawerOpen = false)}
    ></button>
  {/if}

  <!-- Sidebar -->
  <aside
    class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col justify-between border-r border-border bg-page px-3 py-5 transition-transform md:static md:w-48 md:translate-x-0 {drawerOpen
      ? 'translate-x-0'
      : '-translate-x-full'}"
    aria-hidden={!drawerOpen}
  >
    <div>
      <div class="mb-8 flex items-center justify-between px-2">
        <h1 class="flex items-center gap-2 font-mono text-base font-semibold text-text">
          <Logo size={22} class="text-accent" />
          LeadAce
        </h1>
        <button
          type="button"
          class="md:hidden -mr-1 p-1 text-text-muted hover:text-text"
          aria-label="Close menu"
          onclick={() => (drawerOpen = false)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <nav class="space-y-0.5">
        {#each nav as item}
          <a
            href={item.href}
            class="block rounded px-2 py-2 text-sm transition-colors {isActive(item.href)
              ? 'bg-surface-2 text-text font-medium'
              : 'text-text-secondary hover:text-text hover:bg-surface'}"
          >
            {item.label}
          </a>
        {/each}
      </nav>
    </div>
    <div class="space-y-2">
      {#if $plan.data}
        {@const p = $plan.data}
        <a
          href="/settings"
          class="block rounded px-2 py-1.5 text-xs text-text-secondary hover:bg-surface transition-colors"
          title="View plan details"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="capitalize font-medium text-text">{p.isUnlimited ? 'Unlimited' : p.plan}</span>
            <span class="text-[10px] text-text-muted uppercase tracking-wider">
              {p.isUnlimited ? '∞' : p.limits.isLifetime ? 'trial' : 'monthly'}
            </span>
          </div>
          <div class="font-mono text-[11px] text-text-muted">
            Outreach {p.outreach.used}{p.outreach.limit !== null ? `/${p.outreach.limit}` : ''}
          </div>
          {#if p.outreach.limit !== null}
            <div class="mt-1 h-0.5 w-full rounded-full bg-surface">
              <div
                class="h-0.5 rounded-full {p.outreach.remaining === 0 ? 'bg-accent' : 'bg-text-muted'}"
                style="width: {Math.min(100, (p.outreach.used / p.outreach.limit) * 100)}%"
              ></div>
            </div>
          {/if}
        </a>
      {/if}
      <button
        onclick={handleLogout}
        class="px-2 py-1.5 text-left text-xs text-text-muted hover:text-text transition-colors w-full"
      >
        Sign out
      </button>
      <div class="px-2 pt-2 space-y-2">
        <ThemeToggle />
        <div class="flex gap-3 text-[11px] text-text-muted">
          <a href="/terms" class="hover:text-text transition-colors">Terms</a>
          <a href="/privacy" class="hover:text-text transition-colors">Privacy</a>
        </div>
      </div>
    </div>
  </aside>

  <!-- Main -->
  <div class="flex flex-1 flex-col overflow-hidden">
    {#if showCreate}
      <ProjectCreateDialog
        onclose={() => (showCreate = false)}
        oncreated={() => window.location.reload()}
      />
    {/if}
    <!-- Header -->
    <header class="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6">
      <button
        type="button"
        class="-ml-1 p-1 text-text-muted hover:text-text md:hidden"
        aria-label="Open menu"
        aria-expanded={drawerOpen}
        onclick={() => (drawerOpen = true)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
      </button>
      <div class="min-w-0 flex-1">
        <ProjectSwitcher />
      </div>
      <span class="hidden text-xs text-text-muted sm:inline">{$auth.user?.email ?? ''}</span>
    </header>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      {#if $activeProject || page.url.pathname === '/settings'}
        {@render children()}
      {:else}
        <div class="flex flex-col items-center justify-center h-full gap-4">
          <div class="text-center">
            <p class="text-sm text-text">No projects yet</p>
            <p class="text-xs text-text-muted mt-1">
              Create your first project to start tracking prospects and outreach.
            </p>
          </div>
          <button
            onclick={() => (showCreate = true)}
            class="rounded bg-text px-4 py-1.5 text-xs font-medium text-page hover:bg-text/90 transition-colors"
          >
            Create your first project
          </button>
        </div>
      {/if}
    </main>
  </div>
</div>
