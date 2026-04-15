<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth';

  $effect(() => {
    if (!$auth.loading) {
      goto($auth.session ? '/prospects' : '/login');
    }
  });
</script>
