export const API_URL = (import.meta.env?.VITE_API_URL || '').trim().replace(/\/$/, '')

export function resolveAssetUrl(url: string): string {
  if (!url || /^(https?:|blob:|data:)/i.test(url)) return url
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

export const assetUrl = resolveAssetUrl

export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(resolveAssetUrl(url), options)
}

export function realtimeConfig() {
  const base = import.meta.env?.VITE_WS_URL || API_URL || window.location.origin
  const url = new URL(base, window.location.origin)
  const transport = import.meta.env?.VITE_REALTIME_TRANSPORT ||
    (url.hostname.endsWith('.workers.dev') || url.pathname === '/ws' ? 'websocket' : 'socketio')
  if (transport === 'websocket') {
    url.protocol = url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws:' : 'wss:'
    if (url.pathname === '/') url.pathname = '/ws'
  } else {
    url.protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol
  }
  return { url: url.toString().replace(/\/$/, ''), transport }
}
