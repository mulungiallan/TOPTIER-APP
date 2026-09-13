import { useStore } from '@/lib/store'

const API_BASE = '/api'

interface ApiOptions {
  method?: string
  body?: any
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Shared API utility. Requests are sent to the server with the auth token.
 */
export async function apiFetch<T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const store = useStore.getState()
  const token = store.authToken
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }))
    // A revoked/expired session can never be repaired by retrying — clear the
    // persisted session so the app lands back on the login screen and the user
    // re-authenticates with a fresh tokenVersion, instead of erroring forever.
    if (res.status === 401 && error.error?.toLowerCase().includes('revoked')) {
      useStore.getState().logout()
    }
    throw new Error(error.error || `API error: ${res.status}`)
  }
  
  return res.json()
}

// Convenience methods
export const api = {
  get: <T = any>(endpoint: string, opts?: { signal?: AbortSignal }) => 
    apiFetch<T>(endpoint, { signal: opts?.signal }),
  
  post: <T = any>(endpoint: string, body: any) => 
    apiFetch<T>(endpoint, { method: 'POST', body }),
  
  put: <T = any>(endpoint: string, body: any) => 
    apiFetch<T>(endpoint, { method: 'PUT', body }),
  
  patch: <T = any>(endpoint: string, body: any) => 
    apiFetch<T>(endpoint, { method: 'PATCH', body }),
  
  delete: <T = any>(endpoint: string, body?: any) => 
    apiFetch<T>(endpoint, { method: 'DELETE', body }),
}
