import { Hono } from 'hono'
import type { Env } from '../index'
import { updateRoomState } from '../websocket'
import { canSeeEvent, text } from '../features'

export const rehearsalsRouter = new Hono<{ Bindings: Env }>()
rehearsalsRouter.get('/', async c => {
  const ensembleId = c.req.query('ensembleId')
  const query = ensembleId ? c.env.DB.prepare('SELECT * FROM Rehearsal WHERE ensembleId = ? ORDER BY startedAt DESC').bind(ensembleId) : c.env.DB.prepare('SELECT * FROM Rehearsal ORDER BY startedAt DESC')
  const { results } = await query.all()
  return c.json(results)
})
rehearsalsRouter.post('/start', async c => {
  const body = await c.req.json()
  if (typeof body.ensembleId !== 'string' || typeof body.scoreId !== 'string') return c.json({ error: '请先选择乐团和乐谱' }, 400)
  const score = await c.env.DB.prepare('SELECT id FROM Score WHERE id = ? AND ensembleId = ?').bind(body.scoreId, body.ensembleId).first()
  if (!score) return c.json({ error: '乐谱不存在' }, 404)
  const rehearsal = { id: crypto.randomUUID(), ensembleId: body.ensembleId, scoreId: body.scoreId, startedAt: new Date().toISOString(), endedAt: null }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO Rehearsal (id, ensembleId, scoreId, startedAt) VALUES (?, ?, ?, ?)').bind(rehearsal.id, rehearsal.ensembleId, rehearsal.scoreId, rehearsal.startedAt),
    c.env.DB.prepare('INSERT INTO RehearsalEvent (id, rehearsalId, type, data, timestamp) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), rehearsal.id, 'REHEARSAL_STARTED', JSON.stringify({ scoreId: rehearsal.scoreId }), rehearsal.startedAt)
  ])
  await updateRoomState(c.env, rehearsal.ensembleId, { scoreId: rehearsal.scoreId, rehearsalId: rehearsal.id, isRehearsing: true, page: 1 })
  return c.json(rehearsal, 201)
})
rehearsalsRouter.post('/:id/end', async c => {
  const id = c.req.param('id')
  const rehearsal = await c.env.DB.prepare('SELECT * FROM Rehearsal WHERE id = ?').bind(id).first<{ ensembleId: string; endedAt: string | null } & Record<string, unknown>>()
  if (!rehearsal) return c.json({ error: '排练记录不存在' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const endedAt = rehearsal.endedAt || new Date().toISOString()
  const recordingUrl = typeof body.recordingUrl === 'string' ? body.recordingUrl : rehearsal.recordingUrl || null
  if (!rehearsal.endedAt) await c.env.DB.batch([
    c.env.DB.prepare('UPDATE Rehearsal SET endedAt = ?, recordingUrl = ? WHERE id = ?').bind(endedAt, recordingUrl, id),
    c.env.DB.prepare('INSERT INTO RehearsalEvent (id, rehearsalId, type, data, timestamp) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, 'REHEARSAL_ENDED', '{}', endedAt)
  ])
  await updateRoomState(c.env, rehearsal.ensembleId, { isRehearsing: false, rehearsalId: undefined })
  return c.json({ ...rehearsal, endedAt, recordingUrl })
})
rehearsalsRouter.get('/:id', async c => {
  const id = c.req.param('id')
  const rehearsal = await c.env.DB.prepare('SELECT * FROM Rehearsal WHERE id = ?').bind(id).first()
  if (!rehearsal) return c.json({ error: '排练记录不存在' }, 404)
  const { results: events } = await c.env.DB.prepare('SELECT * FROM RehearsalEvent WHERE rehearsalId = ? ORDER BY timestamp').bind(id).all()
  const memberId = c.req.query('memberId')
  const viewer = memberId ? await c.env.DB.prepare('SELECT * FROM Member WHERE id = ? AND ensembleId = ?').bind(memberId, rehearsal.ensembleId).first<any>() : null
  if (memberId && !viewer) return c.json({ error: '成员无权访问此排练' }, 403)
  return c.json({ ...rehearsal, events: events.filter(event => canSeeEvent({ type: String(event.type), data: event.data }, viewer)) })
})
rehearsalsRouter.put('/:id/recording', async c => {
  const rehearsal = await c.env.DB.prepare('SELECT * FROM Rehearsal WHERE id = ?').bind(c.req.param('id')).first<any>()
  if (!rehearsal) return c.json({ error: '排练记录不存在' }, 404)
  const body = await c.req.json()
  const member = typeof body.memberId === 'string' ? await c.env.DB.prepare('SELECT id FROM Member WHERE id = ? AND ensembleId = ? AND role = ?').bind(body.memberId, rehearsal.ensembleId, 'CONDUCTOR').first() : null
  if (!member) return c.json({ error: '只有指挥可以保存录音' }, 403)
  const recordingUrl = text(body.recordingUrl, 4000)
  if (!recordingUrl || !/^(https?:\/\/|\/)/i.test(recordingUrl)) return c.json({ error: '录音文件地址无效' }, 400)
  await c.env.DB.prepare('UPDATE Rehearsal SET recordingUrl = ? WHERE id = ?').bind(recordingUrl, rehearsal.id).run()
  return c.json({ ...rehearsal, recordingUrl })
})
rehearsalsRouter.post('/:id/events', async c => {
  const rehearsalId = c.req.param('id')
  const body = await c.req.json()
  if (typeof body.type !== 'string' || !body.type) return c.json({ error: '排练事件无效' }, 400)
  if (!await c.env.DB.prepare('SELECT id FROM Rehearsal WHERE id = ?').bind(rehearsalId).first()) return c.json({ error: '排练记录不存在' }, 404)
  const event = { id: crypto.randomUUID(), rehearsalId, type: body.type, data: JSON.stringify(body.data || {}), timestamp: new Date().toISOString() }
  await c.env.DB.prepare('INSERT INTO RehearsalEvent (id, rehearsalId, type, data, timestamp) VALUES (?, ?, ?, ?, ?)').bind(event.id, rehearsalId, event.type, event.data, event.timestamp).run()
  return c.json(event, 201)
})
rehearsalsRouter.get('/:id/stats', async c => {
  const id = c.req.param('id')
  const rehearsal = await c.env.DB.prepare('SELECT startedAt, endedAt FROM Rehearsal WHERE id = ?').bind(id).first<{ startedAt: string; endedAt: string | null }>()
  if (!rehearsal) return c.json({ error: '排练记录不存在' }, 404)
  const { results } = await c.env.DB.prepare('SELECT type, COUNT(*) AS count FROM RehearsalEvent WHERE rehearsalId = ? GROUP BY type').bind(id).all<{ type: string; count: number }>()
  const end = rehearsal.endedAt ? new Date(rehearsal.endedAt).getTime() : Date.now()
  return c.json({ duration: Math.max(0, Math.floor((end - new Date(rehearsal.startedAt).getTime()) / 1000)), eventCounts: Object.fromEntries(results.map(event => [event.type, event.count])) })
})
