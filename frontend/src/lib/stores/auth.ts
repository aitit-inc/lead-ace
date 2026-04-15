import { writable } from 'svelte/store';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '$lib/auth';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

function createAuthStore() {
  const { subscribe, set } = writable<AuthState>({
    user: null,
    session: null,
    loading: true,
  });

  // Initialize: check existing session
  supabase.auth.getSession().then(({ data }) => {
    set({
      user: data.session?.user ?? null,
      session: data.session,
      loading: false,
    });
  });

  // Listen for auth state changes (login, logout, token refresh)
  supabase.auth.onAuthStateChange((_event, session) => {
    set({
      user: session?.user ?? null,
      session,
      loading: false,
    });
  });

  return { subscribe };
}

export const auth = createAuthStore();
