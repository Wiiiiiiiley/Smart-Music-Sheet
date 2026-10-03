import { Hono } from 'hono'
import type { Env } from '../index'

export const uploadRouter = new Hono<{ Bindings: Env }>()
const scoreTypes: Record<string, string> = { pdf: 'application/pdf', xml: 'application/xml', musicxml: 'application/vnd.recordare.musicxml+xml', mxl: 'application/vnd.recordare.musicxml' }
const audioTypes: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac' }
function uploadedFile(form: FormData, key: string, fallback = false): File | null {
  const value = form.get(key) || (fallback ? form.get('file') : null)
  return value && typeof value !== 'string' ? value as File : null
}
function checkFile(file: File | null, audio = false): string | null {
  if (!file) return audio ? '没有上传音频文件' : '没有上传乐谱文件'
  if (file.size > 50 * 1024 * 1024) return '文件不能超过 50 MB'
  if (!file.size) return '上传文件为空'
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return (audio ? audioTypes : scoreTypes)[extension] ? null : '不支持的文件类型'
}
async function store(env: Env, file: File, origin: string, audio = false) {
  const extension = file.name.split('.').pop()!.toLowerCase()
  const id = crypto.randomUUID()
  const key = `${audio ? 'audio' : 'scores'}/${id}.${extension}`
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: (audio ? audioTypes : scoreTypes)[extension] } })
  return { id, fileUrl: `${origin}/api/upload/files/${key}`, fileName: file.name, originalName: file.name, fileType: extension === 'pdf' ? 'pdf' : 'musicxml', size: file.size }
}
for (const field of ['score', 'audio'] as const) {
  uploadRouter.post(`/${field}`, async c => {
    const file = uploadedFile(await c.req.formData(), field, true)
    const problem = checkFile(file, field === 'audio')
    if (problem) return c.json({ error: problem }, problem.includes('50 MB') ? 413 : 400)
    return c.json({ success: true, ...await store(c.env, file!, new URL(c.req.url).origin, field === 'audio') })
  })
}
uploadRouter.post('/both', async c => {
  const form = await c.req.formData()
  const score = uploadedFile(form, 'score')
  const audio = uploadedFile(form, 'audio')
  const problem = checkFile(score) || (audio ? checkFile(audio, true) : null)
  if (problem) return c.json({ error: problem }, problem.includes('50 MB') ? 413 : 400)
  const origin = new URL(c.req.url).origin
  const result: Record<string, unknown> = { success: true, score: await store(c.env, score!, origin) }
  if (audio) result.audio = await store(c.env, audio, origin, true)
  return c.json(result)
})

async function fileResponse(env: Env, key: string, request: Request): Promise<Response> {
  if (!/^(scores|audio)\/[^/]+$/.test(key)) return new Response('File not found', { status: 404 })
  const rangeHeader = request.headers.get('range')
  let range: { offset: number; length: number } | undefined
  let size: number | undefined
  if (rangeHeader) {
    const metadata = await env.UPLOADS.head(key)
    if (!metadata) return new Response('File not found', { status: 404 })
    size = metadata.size
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (offset > end || offset >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    range = { offset, length: end - offset + 1 }
  }
  const object = await env.UPLOADS.get(key, range ? { range } : undefined)
  if (!object) return new Response('File not found', { status: 404 })
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Length', String(range ? range.length : object.size))
  headers.set('X-Content-Type-Options', 'nosniff')
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`)
  return new Response(object.body, { headers, status: range ? 206 : 200 })
}
uploadRouter.get('/files/*', c => fileResponse(c.env, decodeURIComponent(c.req.path.slice('/api/upload/files/'.length)), c.req.raw))
// Older clients may have stored an encoded R2 key under /api/upload/:key.
uploadRouter.get('/:key', c => fileResponse(c.env, c.req.param('key'), c.req.raw))
