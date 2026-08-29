import { useStore } from '@/lib/store'

const API_BASE = '/api'

interface ApiOptions {
  method?: string
  body?: any
  headers?: Record<string, string>
  signal?: AbortSignal
}

function isDemoMode(): boolean {
  const token = useStore.getState().authToken
  return !token || token.startsWith('demo-')
}

/**
 * Shared API utility. In demo mode (fake token), all requests return empty
 * data instead of hitting the server and getting 401 errors. This lets
 * demo users browse the UI without broken states.
 */
export async function apiFetch<T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  // Demo mode: return empty structured data so UIs render gracefully
  if (isDemoMode()) {
    return { success: true, data: { signals: [], alerts: [], items: [], notifications: [] } } as T
  }

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
