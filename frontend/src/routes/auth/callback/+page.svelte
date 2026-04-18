<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth';

  // Supabase SDK auto-detects the hash fragment from the email confirmation
  // link and sets the session via onAuthStateChange. Once the auth store
  // reflects that, we route the user into the app.
  $effect(() => {
    if ($auth.loading) return;
    if ($auth.session) {
      goto('/prospects', { replaceState: true });
    } else {
      // No session — likely an expired or already-used link
      goto('/login', { replaceState: true });
    }
  });
</script>

<div class="flex min-h-screen items-center justify-center bg-page">
  <p class="text-text-muted font-mono text-sm">Signing you in...</p>
</div>
