<script lang="ts">
  import '../app.css';
  import { auth } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { children } = $props();

  const publicPaths = ['/login'];

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
{/if}
