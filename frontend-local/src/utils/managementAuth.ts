import { reactive } from 'vue';

export const authState = reactive({
  checked: false, enabled: true, authenticated: false, csrfToken: '', baseUrl: '', error: '',
});

// Keep this module independent of Pinia, the router and axios initialization.
export function managementBaseUrl(): string {
  const fallback = import.meta.env.VITE_API_URL || 'https://sub.store';
  try {
    const saved = JSON.parse(localStorage.getItem('hostAPI') || '{}');
    return (saved.apis?.find((api: { name: string }) => api.name === saved.current)?.url || fallback).replace(/\/$/, '');
  } catch { return fallback.replace(/\/$/, ''); }
}

export class ManagementError extends Error {
  constructor(message: string, public status = 0, public code = '', public deploymentId?: string) {
    super(message);
  }
}

export function goToLogin() {
  authState.authenticated = false;
  authState.csrfToken = '';
  localStorage.removeItem('envCache');
  if (window.location.pathname !== '/login') {
    const redirect = window.location.pathname + window.location.search;
    window.location.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
  }
}

let inFlight: Promise<boolean> | null = null;
let inFlightBase = '';

export async function ensureAuthentication(force = false): Promise<boolean> {
  const base = managementBaseUrl();
  if (!force && authState.checked && authState.baseUrl === base) return authState.authenticated;
  if (inFlight && inFlightBase === base) return inFlight;
  inFlightBase = base;
  const request = (async () => {
    try {
      const response = await fetch(`${base}/api/auth/status`, {
        credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      // Script runtimes from the original project have no Node management API.
      if (response.status === 404) {
        Object.assign(authState, { checked: true, baseUrl: base, enabled: false, authenticated: true, csrfToken: '', error: '' });
        return true;
      }
      const body = await response.json();
      if (!response.ok || body.status !== 'success') throw new Error('认证服务暂时不可用，请稍后重试');
      Object.assign(authState, {
        checked: true, baseUrl: base, enabled: body.data.enabled, authenticated: body.data.authenticated,
        csrfToken: body.data.csrfToken || '', error: '',
      });
      return authState.authenticated;
    } catch {
      Object.assign(authState, { checked: false, authenticated: false, csrfToken: '', error: '暂时无法连接服务器，请稍后重试。' });
      return false;
    }
  })();
  inFlight = request;
  try { return await request; }
  finally { if (inFlight === request) inFlight = null; }
}

export async function managementRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const isLogin = endpoint === '/api/auth/login';
  if (!isLogin && !await ensureAuthentication()) {
    if (authState.checked) goToLogin();
    throw new ManagementError(authState.error || '请先登录', authState.checked ? 401 : 0);
  }
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (authState.csrfToken) headers.set('X-CSRF-Token', authState.csrfToken);
  const response = await fetch(`${managementBaseUrl()}${endpoint}`, {
    ...options, headers, credentials: 'include', cache: 'no-store', signal: options.signal || AbortSignal.timeout(20000),
  });
  let body;
  try { body = await response.json(); }
  catch { throw new ManagementError('服务器正在重启或暂时不可用', response.status); }
  if (response.status === 401 && !isLogin) goToLogin();
  if (!response.ok || body.status !== 'success') {
    throw new ManagementError(body.error?.message || '请求失败', response.status, body.error?.code, body.error?.deploymentId);
  }
  return body.data as T;
}

export async function login(password: string) {
  await managementRequest('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password }) });
  if (!await ensureAuthentication(true)) throw new Error('未能保持登录状态，请检查浏览器是否允许本站 Cookie。');
}

export async function logout() {
  await managementRequest('/api/auth/logout', { method: 'POST', body: '{}' });
  authState.checked = false;
  goToLogin();
}
