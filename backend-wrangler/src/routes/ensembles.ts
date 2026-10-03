import { Hono } from 'hono'
import type { Env } from '../index'
import { canReceiveTarget, parseJSON, scoreJSON } from '../features'

export const ensemblesRouter = new Hono<{ Bindings: Env }>()
ensemblesRouter.get('/', async c => {
  const { results } = await c.env.DB.prepare('SELECT * FROM Ensemble ORDER BY createdAt DESC').all()
  return c.json(results)
})
ensemblesRouter.post('/', async c => {
  const body = await c.req.json()
  if (typeof body.name !== 'string' || !body.name.trim() || typeof body.conductorId !== 'string' || !body.conductorId) return c.json({ error: '请填写乐团名称和指挥信息' }, 400)
  const id = crypto.randomUUID()
  const occupied = await c.env.DB.prepare('SELECT id FROM Member WHERE id = ?').bind(body.conductorId).first()
  const conductorId = occupied ? crypto.randomUUID() : body.conductorId
  const name = body.name.trim()
  const conductorName = typeof body.conductorName === 'string' && body.conductorName.trim() ? body.conductorName.trim() : '指挥'
  const now = new Date().toISOString()
  await c.env.DB.batch<any>([
    c.env.DB.prepare('INSERT INTO Ensemble (id, name, conductorId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').bind(id, name, conductorId, now, now),
    c.env.DB.prepare('INSERT INTO Member (id, name, role, ensembleId, createdAt) VALUES (?, ?, ?, ?, ?)').bind(conductorId, conductorName, 'CONDUCTOR', id, now)
  ])
  return c.json({ id, name, conductorId, createdAt: now, updatedAt: now, members: [{ id: conductorId, name: conductorName, role: 'CONDUCTOR', ensembleId: id }], scores: [] }, 201)
})
ensemblesRouter.get('/:id', async c => {
  const id = c.req.param('id')
  const ensemble = await c.env.DB.prepare('SELECT * FROM Ensemble WHERE id = ?').bind(id).first()
  if (!ensemble) return c.json({ error: '乐团不存在' }, 404)
  const [members, scores] = await c.env.DB.batch<any>([
    c.env.DB.prepare('SELECT * FROM Member WHERE ensembleId = ? ORDER BY role, section').bind(id),
    c.env.DB.prepare('SELECT * FROM Score WHERE ensembleId = ? ORDER BY createdAt DESC').bind(id)
  ])
  return c.json({ ...ensemble, members: members.results, scores: scores.results.map(scoreJSON) })
})
ensemblesRouter.post('/:id/members', async c => {
  const ensembleId = c.req.param('id')
  const body = await c.req.json()
  const role = body.role || 'PLAYER'
  if (typeof body.name !== 'string' || !body.name.trim() || !['PLAYER', 'CONDUCTOR'].includes(role)) return c.json({ error: '成员信息无效' }, 400)
  if (!await c.env.DB.prepare('SELECT id FROM Ensemble WHERE id = ?').bind(ensembleId).first()) return c.json({ error: '乐团不存在' }, 404)
  const existing = typeof body.id === 'string' && body.id ? await c.env.DB.prepare('SELECT * FROM Member WHERE id = ?').bind(body.id).first() : null
  if (existing?.ensembleId === ensembleId) return c.json(existing)
  if (role === 'CONDUCTOR') return c.json({ error: '乐团已有指挥' }, 400)
  const id = typeof body.id === 'string' && body.id && !existing ? body.id : crypto.randomUUID()
  const now = new Date().toISOString()
  const member = { id, name: body.name.trim(), role, instrument: typeof body.instrument === 'string' ? body.instrument : null, section: typeof body.section === 'string' && body.section ? body.section : null, ensembleId, createdAt: now }
  await c.env.DB.prepare('INSERT INTO Member (id, name, role, instrument, section, ensembleId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, member.name, role, member.instrument, member.section, ensembleId, now).run()
  return c.json(member, 201)
})
ensemblesRouter.put('/:id/members/:memberId', async c => {
  const member = await c.env.DB.prepare('SELECT * FROM Member WHERE id = ? AND ensembleId = ?').bind(c.req.param('memberId'), c.req.param('id')).first()
  if (!member) return c.json({ error: '成员不存在' }, 404)
  const body = await c.req.json()
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : member.name
  const instrument = typeof body.instrument === 'string' ? body.instrument : member.instrument
  const section = typeof body.section === 'string' ? body.section || null : member.section
  await c.env.DB.prepare('UPDATE Member SET name = ?, instrument = ?, section = ? WHERE id = ?').bind(name, instrument, section, member.id).run()
  return c.json({ ...member, name, instrument, section })
})
ensemblesRouter.delete('/:id/members/:memberId', async c => {
  const member = await c.env.DB.prepare('SELECT id, role FROM Member WHERE id = ? AND ensembleId = ?').bind(c.req.param('memberId'), c.req.param('id')).first()
  if (!member) return c.json({ error: '成员不存在' }, 404)
  if (member.role === 'CONDUCTOR') return c.json({ error: '不能删除乐团指挥' }, 400)
  await c.env.DB.batch<any>([c.env.DB.prepare('DELETE FROM Mark WHERE creatorId = ?').bind(member.id), c.env.DB.prepare('DELETE FROM Member WHERE id = ?').bind(member.id)])
  return c.json({ success: true })
})
ensemblesRouter.get('/:id/sections', async c => {
  const { results } = await c.env.DB.prepare('SELECT section AS name, COUNT(*) AS memberCount FROM Member WHERE ensembleId = ? AND section IS NOT NULL GROUP BY section').bind(c.req.param('id')).all()
  return c.json(results)
})

ensemblesRouter.get('/:id/cues', async c => {
  const id = c.req.param('id')
  if (!await c.env.DB.prepare('SELECT id FROM Ensemble WHERE id = ?').bind(id).first()) return c.json({ error: '乐团不存在' }, 404)
  const memberId = c.req.query('memberId')
  const viewer = memberId ? await c.env.DB.prepare('SELECT * FROM Member WHERE id = ? AND ensembleId = ?').bind(memberId, id).first<any>() : null
  if (memberId && !viewer) return c.json({ error: '成员无权访问此乐团' }, 403)
  const { results } = await c.env.DB.prepare('SELECT RehearsalEvent.* FROM RehearsalEvent JOIN Rehearsal ON Rehearsal.id = RehearsalEvent.rehearsalId WHERE Rehearsal.ensembleId = ? AND RehearsalEvent.type = ? ORDER BY RehearsalEvent.timestamp DESC LIMIT 100').bind(id, 'CUE_SENT').all()
  return c.json(results.map(event => parseJSON(event.data)).filter(data => canReceiveTarget(data, viewer)).reverse())
})
