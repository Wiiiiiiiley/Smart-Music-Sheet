import { Hono } from 'hono'
import type { Env } from '../index'
import { publishRoomEvent } from '../websocket'
import { canSeeMark, canReceiveTarget, scoreJSON, FeatureError, validateTimings, validateTracks, validateRegions } from '../features'

export const scoresRouter = new Hono<{ Bindings: Env }>()
async function scoreAndViewer(env: Env, id: string, memberId?: unknown, conductorOnly = false) {
  const score = await env.DB.prepare('SELECT * FROM Score WHERE id = ?').bind(id).first<any>()
  if (!score) throw new FeatureError('乐谱不存在', 404)
  const viewer = typeof memberId === 'string' && memberId ? await env.DB.prepare('SELECT * FROM Member WHERE id = ? AND ensembleId = ?').bind(memberId, score.ensembleId).first<any>() : null
  if ((memberId !== undefined && !viewer) || (conductorOnly && viewer?.role !== 'CONDUCTOR')) throw new FeatureError('成员无权访问此乐谱', 403)
  return { score, viewer }
}
scoresRouter.get('/', async c => {
  const ensembleId = c.req.query('ensembleId')
  const query = ensembleId ? c.env.DB.prepare('SELECT * FROM Score WHERE ensembleId = ? ORDER BY createdAt DESC').bind(ensembleId) : c.env.DB.prepare('SELECT * FROM Score ORDER BY createdAt DESC')
  const { results } = await query.all<any>()
  return c.json(results.map(scoreJSON))
})
scoresRouter.post('/', async c => {
  const body = await c.req.json()
  if (typeof body.title !== 'string' || !body.title.trim() || typeof body.fileUrl !== 'string' || !body.fileUrl || !['pdf', 'musicxml'].includes(body.fileType) || typeof body.ensembleId !== 'string') throw new FeatureError('乐谱信息无效')
  if (!await c.env.DB.prepare('SELECT id FROM Ensemble WHERE id = ?').bind(body.ensembleId).first()) throw new FeatureError('乐团不存在', 404)
  const score = { id: crypto.randomUUID(), title: body.title.trim(), composer: typeof body.composer === 'string' && body.composer ? body.composer : null, fileUrl: body.fileUrl, fileType: body.fileType, audioUrl: typeof body.audioUrl === 'string' && body.audioUrl ? body.audioUrl : null, ensembleId: body.ensembleId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audioTracks: '[]' }
  await c.env.DB.prepare('INSERT INTO Score (id, title, composer, fileUrl, fileType, audioUrl, ensembleId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(score.id, score.title, score.composer, score.fileUrl, score.fileType, score.audioUrl, score.ensembleId, score.createdAt, score.updatedAt).run()
  return c.json({ ...scoreJSON(score), measures: [], marks: [] }, 201)
})
scoresRouter.get('/:id', async c => {
  const { score, viewer } = await scoreAndViewer(c.env, c.req.param('id'), c.req.query('memberId'))
  const [measures, marks, cues] = await c.env.DB.batch<any>([
    c.env.DB.prepare('SELECT * FROM Measure WHERE scoreId = ? ORDER BY number').bind(score.id),
    c.env.DB.prepare('SELECT * FROM Mark WHERE scoreId = ? ORDER BY createdAt').bind(score.id),
    c.env.DB.prepare('SELECT Cue.* FROM Cue JOIN Measure ON Measure.id = Cue.measureId WHERE Measure.scoreId = ?').bind(score.id)
  ])
  return c.json({ ...scoreJSON(score), measures: measures.results.map(measure => ({ ...measure, cues: cues.results.filter(cue => cue.measureId === measure.id && canReceiveTarget(cue, viewer)) })), marks: marks.results.filter(mark => canSeeMark(mark, viewer)).map(mark => ({ ...mark, private: Boolean(mark.private) })) })
})
scoresRouter.get('/:id/marks', async c => {
  const { score, viewer } = await scoreAndViewer(c.env, c.req.param('id'), c.req.query('memberId'))
  const { results } = await c.env.DB.prepare('SELECT * FROM Mark WHERE scoreId = ? ORDER BY createdAt').bind(score.id).all()
  return c.json(results.filter(mark => canSeeMark(mark, viewer)).map(mark => ({ ...mark, private: Boolean(mark.private) })))
})
scoresRouter.put('/:id', async c => {
  const { score } = await scoreAndViewer(c.env, c.req.param('id'))
  const body = await c.req.json()
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : score.title
  const composer = typeof body.composer === 'string' ? body.composer : score.composer
  const audioUrl = typeof body.audioUrl === 'string' ? body.audioUrl : score.audioUrl
  const updatedAt = new Date().toISOString()
  await c.env.DB.prepare('UPDATE Score SET title = ?, composer = ?, audioUrl = ?, updatedAt = ? WHERE id = ?').bind(title, composer, audioUrl, updatedAt, score.id).run()
  return c.json(scoreJSON({ ...score, title, composer, audioUrl, updatedAt }))
})
scoresRouter.delete('/:id', async c => {
  const { score } = await scoreAndViewer(c.env, c.req.param('id'))
  await c.env.DB.batch<any>([c.env.DB.prepare('UPDATE Rehearsal SET scoreId = NULL WHERE scoreId = ?').bind(score.id), c.env.DB.prepare('DELETE FROM Score WHERE id = ?').bind(score.id)])
  return c.json({ success: true })
})
scoresRouter.put('/:id/measures', async c => {
  const body = await c.req.json()
  const { score } = await scoreAndViewer(c.env, c.req.param('id'), body.memberId, true)
  const incoming = validateTimings(body.measures)
  const { results: previous } = await c.env.DB.prepare('SELECT * FROM Measure WHERE scoreId = ?').bind(score.id).all<any>()
  const statements: D1PreparedStatement[] = [], retainedIds: string[] = []
  for (const timing of incoming) {
    const existing = previous.find(measure => measure.number === timing.number)
    const startTime = timing.startTime === undefined ? existing?.startTime ?? null : timing.startTime
    const endTime = timing.endTime === undefined ? existing?.endTime ?? null : timing.endTime
    validateTimings([{ ...timing, startTime, endTime }])
    const id = existing?.id || crypto.randomUUID()
    retainedIds.push(id)
    statements.push(existing
      ? c.env.DB.prepare('UPDATE Measure SET startTime = ?, endTime = ? WHERE id = ?').bind(startTime, endTime, id)
      : c.env.DB.prepare('INSERT INTO Measure (id, number, scoreId, startTime, endTime) VALUES (?, ?, ?, ?, ?)').bind(id, timing.number, score.id, startTime, endTime))
  }
  for (const previousMeasure of previous) if (!retainedIds.includes(previousMeasure.id)) statements.push(c.env.DB.prepare('DELETE FROM Measure WHERE id = ?').bind(previousMeasure.id))
  if (statements.length) await c.env.DB.batch(statements)
  const { results } = await c.env.DB.prepare('SELECT * FROM Measure WHERE scoreId = ? ORDER BY number').bind(score.id).all()
  return c.json(results.map(measure => ({ ...measure, cues: [] })))
})
scoresRouter.put('/:id/layout', async c => {
  const body = await c.req.json()
  const { score } = await scoreAndViewer(c.env, c.req.param('id'), body.memberId, true)
  const regions = validateRegions(body.regions)
  await c.env.DB.prepare('UPDATE Score SET measureRegions = ?, updatedAt = ? WHERE id = ?').bind(JSON.stringify(regions), new Date().toISOString(), score.id).run()
  await publishRoomEvent(c.env, score.ensembleId, 'score-layout-updated', { scoreId: score.id, regions })
  return c.json(regions)
})
scoresRouter.get('/:id/tracks', async c => {
  const { score } = await scoreAndViewer(c.env, c.req.param('id'), c.req.query('memberId'))
  return c.json(scoreJSON(score).audioTracks)
})
scoresRouter.put('/:id/tracks', async c => {
  const body = await c.req.json()
  const { score } = await scoreAndViewer(c.env, c.req.param('id'), body.memberId, true)
  const tracks = validateTracks(body.tracks)
  await c.env.DB.prepare('UPDATE Score SET audioTracks = ?, updatedAt = ? WHERE id = ?').bind(JSON.stringify(tracks), new Date().toISOString(), score.id).run()
  await publishRoomEvent(c.env, score.ensembleId, 'score-tracks-updated', { scoreId: score.id, tracks })
  return c.json(tracks)
})
scoresRouter.post('/:id/measures/:measureId/cues', async c => {
  const measure = await c.env.DB.prepare('SELECT id FROM Measure WHERE id = ? AND scoreId = ?').bind(c.req.param('measureId'), c.req.param('id')).first()
  if (!measure) throw new FeatureError('小节不存在', 404)
  const body = await c.req.json()
  if (!['CLICK', 'COUNT_IN', 'METRONOME', 'DEMO_AUDIO'].includes(body.type)) throw new FeatureError('提示类型无效')
  const cue = { id: crypto.randomUUID(), measureId: measure.id, type: body.type, targetSection: body.targetSection || null, audioUrl: body.audioUrl || null, bpm: body.bpm ?? null, timeSignature: body.timeSignature || null, createdAt: new Date().toISOString() }
  await c.env.DB.prepare('INSERT INTO Cue (id, type, measureId, targetSection, audioUrl, bpm, timeSignature, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(cue.id, cue.type, cue.measureId, cue.targetSection, cue.audioUrl, cue.bpm, cue.timeSignature, cue.createdAt).run()
  return c.json(cue, 201)
})
scoresRouter.put('/:id/measures/:measureId/timing', async c => {
  const measure = await c.env.DB.prepare('SELECT * FROM Measure WHERE id = ? AND scoreId = ?').bind(c.req.param('measureId'), c.req.param('id')).first<any>()
  if (!measure) throw new FeatureError('小节不存在', 404)
  const body = await c.req.json()
  const startTime = body.startTime === undefined ? measure.startTime : body.startTime
  const endTime = body.endTime === undefined ? measure.endTime : body.endTime
  validateTimings([{ number: measure.number, startTime, endTime }])
  await c.env.DB.prepare('UPDATE Measure SET startTime = ?, endTime = ? WHERE id = ?').bind(startTime, endTime, measure.id).run()
  return c.json({ ...measure, startTime, endTime })
})
