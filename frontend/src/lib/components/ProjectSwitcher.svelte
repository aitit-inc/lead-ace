<script lang="ts">
  import { get } from '$lib/api';
  import { activeProject } from '$lib/stores/project';
  import type { Project } from '$lib/types';
  import ProjectCreateDialog from './ProjectCreateDialog.svelte';

  let projects = $state<Project[]>([]);
  let loading = $state(true);
  let showCreate = $state(false);

  async function loadProjects() {
    loading = true;
    const { projects: p } = await get<{ projects: Project[] }>('/projects');
    projects = p;
    // Auto-select if none selected or saved project no longer exists
    if (projects.length > 0) {
      const current = $activeProject;
      if (!current || !projects.find((proj) => proj.id === current)) {
        activeProject.set(projects[0].id);
      }
    } else {
      activeProject.set(null);
    }
    loading = false;
  }

  $effect(() => {
    loadProjects();
  });

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    activeProject.set(target.value);
  }
</script>

<div class="flex items-center gap-3">
  {#if loading}
    <span class="text-text-muted text-xs font-mono">...</span>
  {:else if projects.length === 0}
    <span class="text-text-muted text-xs">No projects</span>
  {:else}
    <select
      value={$activeProject}
      onchange={handleChange}
      class="bg-transparent text-sm font-mono text-text outline-none cursor-pointer pr-6 py-1 appearance-none"
      style="background-image: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23948D8A%22 stroke-width=%222%22%3E%3Cpath d=%22M6 9l6 6 6-6%22/%3E%3C/svg%3E'); background-repeat: no-repeat; background-position: right 0 center;"
    >
      {#each projects as proj}
        <option value={proj.id}>{proj.name}</option>
      {/each}
    </select>
  {/if}
  <button
    onclick={() => (showCreate = true)}
    class="text-xs text-text-muted hover:text-text transition-colors"
    title="Create new project"
  >
    + New
  </button>
</div>

{#if showCreate}
  <ProjectCreateDialog
    onclose={() => (showCreate = false)}
    oncreated={() => loadProjects()}
  />
{/if}
