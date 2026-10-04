import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { ensemblesRouter } from './routes/ensembles'
import { scoresRouter } from './routes/scores'
import { rehearsalsRouter } from './routes/rehearsals'
import { uploadRouter } from './routes/upload'
import { websocketHandler } from './websocket'
import { FeatureError } from './features'

export interface Env extends Record<string, unknown> {
  DB: D1Database
  CORS_ORIGIN: string
  UPLOADS: R2Bucket
  WEBSOCKET: DurableObjectNamespace
  APP_REVISION?: string
}
export { WebSocketServer } from './websocket'
const app = new Hono<{ Bindings: Env }>()
app.use('*', logger())
// No cookies or credentials are used; wildcard CORS allows Pages previews and local clients.
app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization', 'Range'], exposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag'] }))
app.get('/health', c => c.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  service: 'EduTempo API',
  apiVersion: 2,
  capabilities: ['ensemble-websocket', 'cue-history'],
  revision: c.env.APP_REVISION || 'development',
}))
app.get('/ws', websocketHandler)
app.route('/api/ensembles', ensemblesRouter)
app.route('/api/scores', scoresRouter)
app.route('/api/rehearsals', rehearsalsRouter)
app.route('/api/upload', uploadRouter)
app.notFound(c => c.json({ error: 'Not Found' }, 404))
app.onError((err, c) => {
  if (err instanceof FeatureError) return c.json({ error: err.message }, err.status as 400 | 403 | 404 | 409 | 500)
  console.error('Request failed:', err.message)
  return c.json({ error: err instanceof SyntaxError ? '请求数据格式错误' : '服务器处理请求失败' }, err instanceof SyntaxError ? 400 : 500)
})
export default app
