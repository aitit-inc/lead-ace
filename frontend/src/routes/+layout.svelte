<script lang="ts">
  import '../app.css';
  import { auth } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import CookieBanner from '$lib/components/CookieBanner.svelte';

  let { children } = $props();

  // /mcp-authorize is listed here so the global guard does not strip its
  // session id when redirecting unauthenticated users — that page handles
  // its own /login?next=… redirect to preserve the deep link round-trip.
  const publicPaths = ['/login', '/auth/callback', '/mcp-authorize', '/terms', '/privacy'];

  $effect(() => {
    if ($auth.loading) return;
    const isPublic = publicPaths.some((p) => page.url.pathname.startsWith(p));
    if (!$auth.session && !isPublic) {
      goto('/login');
    } else if ($auth.session && page.url.pathname === '/login') {
      goto('/prospects');
    }
  });
</script>

{#if $auth.loading}
  <div class="flex h-screen items-center justify-center">
    <p class="text-text-muted font-mono text-sm">Loading...</p>
  </div>
{:else}
  {@render children()}
  <CookieBanner />
{/if}
