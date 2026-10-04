import { pathToFileURL } from 'node:url'

const requiredCapabilities = ['ensemble-websocket', 'cue-history']

function configuration(apiUrl, expectedRevision) {
  if (typeof apiUrl !== 'string' || !apiUrl.trim()) throw new Error('API_URL is required')
  if (typeof expectedRevision !== 'string' || !expectedRevision.trim()) throw new Error('EXPECTED_REVISION is required')
  let base
  try { base = new URL(apiUrl.trim()) } catch { throw new Error('API_URL must be an absolute HTTP(S) URL') }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('API_URL must be an HTTP(S) origin without credentials, path, query, or fragment')
  }
  return { base, expectedRevision: expectedRevision.trim() }
}

async function request(base, pathname, timeoutMs) {
  try {
    return await fetch(new URL(pathname, base), {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error(`${pathname.split('?')[0]} request failed or timed out`)
  }
}

async function json(response, pathname) {
  try { return await response.json() } catch { throw new Error(`${pathname} did not return valid JSON`) }
}

async function probe(base, expectedRevision, timeoutMs) {
  const healthResponse = await request(base, '/health', timeoutMs)
  if (healthResponse.status !== 200) throw new Error(`/health returned HTTP ${healthResponse.status}; expected 200`)
  const health = await json(healthResponse, '/health')
  if (health?.status !== 'ok' || health?.apiVersion !== 2) throw new Error('/health does not advertise API version 2')
  if (health.revision !== expectedRevision) throw new Error('/health revision does not match this deployment')
  if (!Array.isArray(health.capabilities) || requiredCapabilities.some(capability => !health.capabilities.includes(capability))) {
    throw new Error('/health is missing ensemble WebSocket or cue history capability')
  }

  const websocketResponse = await request(base, '/ws?ensembleId=deployment-check&userId=deployment-check', timeoutMs)
  const websocketStatus = websocketResponse.status
  await websocketResponse.body?.cancel()
  if (websocketStatus !== 426) throw new Error(`/ws returned HTTP ${websocketStatus}; expected 426 without WebSocket Upgrade`)

  const cuesPath = '/api/ensembles/nonexistent/cues'
  const cuesResponse = await request(base, cuesPath, timeoutMs)
  if (cuesResponse.status !== 404) throw new Error(`${cuesPath} returned HTTP ${cuesResponse.status}; expected 404 for missing ensemble`)
  const cues = await json(cuesResponse, cuesPath)
  if (cues?.error !== '乐团不存在') throw new Error(`${cuesPath} returned an unexpected error; cue history route may be missing`)
}

// Read-only probes never create ensembles, members, WebSocket sessions, or cues.
export async function verifyDeployment({
  apiUrl, expectedRevision, attempts = 6, timeoutMs = 5000, retryDelayMs = 2000,
  log = message => console.log(message),
} = {}) {
  const config = configuration(apiUrl, expectedRevision)
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 || !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5000) {
    throw new Error('Smoke check bounds are invalid')
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await probe(config.base, config.expectedRevision, timeoutMs)
      log('Deployment verified: expected revision, API version 2, WebSocket route, and cue history route.')
      return
    } catch (error) {
      log(`Deployment smoke attempt ${attempt}/${attempts}: ${error.message}`)
      if (attempt === attempts) throw new Error(`Deployment verification failed after ${attempts} attempts: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDeployment({ apiUrl: process.env.API_URL, expectedRevision: process.env.EXPECTED_REVISION })
    .catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1 })
}
