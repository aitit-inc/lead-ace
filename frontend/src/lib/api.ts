import { goto } from '$app/navigation';
import { supabase } from './auth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
export const MCP_BASE = import.meta.env.VITE_MCP_URL ?? 'http://localhost:8788';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

let redirecting = false;

async function handleUnauthorized(): Promise<void> {
  if (redirecting) return;
  redirecting = true;
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore — session may already be gone
  }
  const here = window.location.pathname + window.location.search;
  const onLogin = window.location.pathname === '/login';
  const next = !onLogin ? `?next=${encodeURIComponent(here)}` : '';
  await goto(`/login${next}`, { replaceState: true });
}

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    void handleUnauthorized();
    throw new ApiError(401, 'Not authenticated');
  }
  return token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) {
      void handleUnauthorized();
    }
    throw new ApiError(res.status, err.error ?? 'Unknown error', err.detail);
  }
  return res.json();
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body: unknown) => request<T>('POST', path, body);
export const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
export const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
export const del = <T>(path: string) => request<T>('DELETE', path);
