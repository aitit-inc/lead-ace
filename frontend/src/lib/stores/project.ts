import { writable } from 'svelte/store';

const STORAGE_KEY = 'leadace_active_project';

function createProjectStore() {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  const { subscribe, set: _set } = writable<string | null>(saved);

  function set(projectId: string | null) {
    _set(projectId);
    if (typeof localStorage !== 'undefined') {
      if (projectId) {
        localStorage.setItem(STORAGE_KEY, projectId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  return { subscribe, set };
}

export const activeProject = createProjectStore();
