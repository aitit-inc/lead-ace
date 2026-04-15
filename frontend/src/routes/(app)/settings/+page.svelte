<script lang="ts">
  import { del } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  let showDeleteDialog = $state(false);
  let deleting = $state(false);
  let message = $state('');

  async function handleDelete() {
    const pid = $activeProject;
    if (!pid) return;
    deleting = true;
    try {
      await del(`/projects/${pid}`);
      message = `Project "${pid}" deleted.`;
      activeProject.set(null);
      // Reload to trigger project switcher refresh
      window.location.href = '/prospects';
    } catch (e) {
      message = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
    deleting = false;
    showDeleteDialog = false;
  }
</script>

<h2 class="text-lg font-semibold text-text mb-6">Settings</h2>

{#if message}
  <div class="mb-6 rounded bg-surface px-4 py-3 text-sm text-text">{message}</div>
{/if}

<!-- Danger zone -->
<section>
  <h3 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Danger Zone</h3>

  <div class="rounded-lg border border-accent/20 p-4">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-text">Delete project</p>
        <p class="text-xs text-text-secondary mt-0.5">
          Permanently delete <span class="font-mono font-medium">{$activeProject}</span> and all its data (prospects, outreach logs, responses, evaluations).
        </p>
      </div>
      <button
        onclick={() => (showDeleteDialog = true)}
        disabled={deleting}
        class="rounded px-3 py-1.5 text-xs font-medium text-accent border border-accent/30 hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  </div>
</section>

{#if showDeleteDialog}
  <ConfirmDialog
    title="Delete project"
    message="This will permanently delete the project and all associated data. This action cannot be undone."
    confirmLabel={deleting ? 'Deleting...' : 'Delete'}
    danger
    onconfirm={handleDelete}
    oncancel={() => (showDeleteDialog = false)}
  />
{/if}
