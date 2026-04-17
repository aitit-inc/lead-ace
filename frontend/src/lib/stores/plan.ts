import { writable } from 'svelte/store';
import { get as apiGet } from '$lib/api';
import type { PlanInfo } from '$lib/types';

interface PlanState {
  data: PlanInfo | null;
  loading: boolean;
  error: string | null;
}

function createPlanStore() {
  const { subscribe, set, update } = writable<PlanState>({
    data: null,
    loading: false,
    error: null,
  });

  async function load() {
    update((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiGet<PlanInfo>('/me/plan');
      set({ data, loading: false, error: null });
    } catch (e) {
      set({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  function reset() {
    set({ data: null, loading: false, error: null });
  }

  return { subscribe, load, reset };
}

export const plan = createPlanStore();
