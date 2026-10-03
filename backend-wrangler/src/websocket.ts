import type { Context } from 'hono'
import type { Env } from './index'
import { canSeeMark, canReceiveTarget, text, validatePosition, FeatureError } from './features'

type Member = { id: string; ensembleId: string; role: string; section?: string | null }
type Session = { socketId: string; ensembleId: string; memberId: string; joined: boolean; audioJoined: boolean; role?: string; section?: string | null }
type RoomState = { scoreId?: string; rehearsalId?: string; isRehearsing: boolean; page: number; position?: Record<string, any> }

export const websocketHandler = async (c: Context<{ Bindings: Env }>) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return c.json({ error: 'Expected Upgrade: websocket' }, 426)
  const ensembleId = c.req.query('ensembleId')
  const userId = c.req.query('userId')
  if (!ensembleId || !userId) return c.json({ error: 'Missing ensembleId or userId' }, 400)
  const id = c.env.WEBSOCKET.idFromName(ensembleId)
  return c.env.WEBSOCKET.get(id).fetch(c.req.raw)
}

// Persist REST changes in the same room so late joins see the current rehearsal.
export async function updateRoomState(env: Env, ensembleId: string, state: Partial<RoomState>) {
  const id = env.WEBSOCKET.idFromName(ensembleId)
  const response = await env.WEBSOCKET.get(id).fetch('https://room.internal/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
  if (!response.ok) throw new Error('Failed to save rehearsal room state')
}

export async function publishRoomEvent(env: Env, ensembleId: string, event: string, data: unknown) {
  const id = env.WEBSOCKET.idFromName(ensembleId)
  const response = await env.WEBSOCKET.get(id).fetch('https://room.internal/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, data }) })
  if (!response.ok) throw new Error('Failed to publish room update')
}

export class WebSocketServer {
  private queue: Promise<void> = Promise.resolve()
  private room: RoomState = { isRehearsing: false, page: 1 }
  constructor(private state: DurableObjectState, private env: Env) {
    state.blockConcurrencyWhile(async () => {
      this.room = await state.storage.get<RoomState>('room') || this.room
    })
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/publish' && request.method === 'POST') {
      const update = await request.json() as { event: string; data: unknown }
      this.broadcast(update.event, update.data)
      return new Response('ok')
    }
    if (url.pathname === '/state' && request.method === 'POST') {
      Object.assign(this.room, await request.json())
      await this.saveRoom()
      return new Response('ok')
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected websocket', { status: 426 })
    const ensembleId = url.searchParams.get('ensembleId')
    const memberId = url.searchParams.get('userId')
    if (!ensembleId || !memberId) return new Response('Missing room or member', { status: 400 })
    const pair = new WebSocketPair()
    const session: Session = { socketId: crypto.randomUUID(), ensembleId, memberId, joined: false, audioJoined: false }
    pair[1].serializeAttachment(session)
    this.state.acceptWebSocket(pair[1])
    this.send(pair[1], 'connected', { socketId: session.socketId })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }
  private session(ws: WebSocket): Session { return ws.deserializeAttachment() as Session }
  private send(ws: WebSocket, event: string, data?: unknown) {
    try { ws.send(JSON.stringify({ event, data })) } catch { /* Closed sessions are removed by the close callback. */ }
  }
  private error(ws: WebSocket, message: string) { this.send(ws, 'error', { message }) }
  private async saveRoom() { await this.state.storage.put('room', this.room) }
  private broadcast(event: string, data: unknown, sender?: WebSocket, section?: string, audioOnly = false) {
    for (const ws of this.state.getWebSockets()) {
      const session = this.session(ws)
      if (ws === sender || !session.joined || (audioOnly && !session.audioJoined)) continue
      if (section && session.role !== 'CONDUCTOR' && session.section !== section) continue
      this.send(ws, event, data)
    }
  }
  private viewer(session: Session) { return { id: session.memberId, role: session.role || '', section: session.section } }
  private visibleBroadcast(event: string, data: unknown, visible: (session: Session) => boolean) {
    for (const target of this.state.getWebSockets()) {
      const session = this.session(target)
      if (session.joined && visible(session)) this.send(target, event, data)
    }
  }
  private async targets(data: any, session: Session) {
    const targetSection = text(data?.targetSection, 100), targetMemberId = text(data?.targetMemberId, 200)
    if (data?.targetMemberId && !targetMemberId) throw new FeatureError('目标成员无效')
    if (targetMemberId && !await this.env.DB.prepare('SELECT id FROM Member WHERE id = ? AND ensembleId = ?').bind(targetMemberId, session.ensembleId).first()) throw new FeatureError('目标成员不属于当前乐团')
    return { targetSection, targetMemberId }
  }
  private async persistEvent(type: string, data: any, session: Session) {
    const rehearsal = await this.env.DB.prepare('SELECT id FROM Rehearsal WHERE ensembleId = ? AND endedAt IS NULL ORDER BY startedAt DESC LIMIT 1').bind(session.ensembleId).first<{ id: string }>()
    if (rehearsal) await this.env.DB.prepare('INSERT INTO RehearsalEvent (id, rehearsalId, type, data, timestamp) VALUES (?, ?, ?, ?, ?)').bind(data.id, rehearsal.id, type, JSON.stringify(data), new Date(data.timestamp).toISOString()).run()
  }
  private leave(ws: WebSocket) {
    const session = this.session(ws)
    if (session.joined) this.broadcast('member-left', { memberId: session.memberId, socketId: session.socketId }, ws)
    if (session.audioJoined) this.broadcast('audio-member-left', { memberId: session.memberId, socketId: session.socketId }, ws, undefined, true)
    session.joined = false
    session.audioJoined = false
    ws.serializeAttachment(session)
  }
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.queue = this.queue.then(() => this.handleMessage(ws, message))
    return this.queue
  }
  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      if (typeof message !== 'string') return this.error(ws, '不支持的消息格式')
      const { event, data } = JSON.parse(message)
      const session = this.session(ws)
      if (event === 'join-ensemble') {
        if (!data || data.ensembleId !== session.ensembleId || data.memberId !== session.memberId) return this.error(ws, '乐团或成员信息无效')
        const member = await this.env.DB.prepare('SELECT id, ensembleId, role, section FROM Member WHERE id = ? AND ensembleId = ?').bind(session.memberId, session.ensembleId).first<Member>()
        if (!member) return this.error(ws, '请先加入乐团')
        const alreadyJoined = session.joined
        Object.assign(session, { joined: true, role: member.role, section: member.section })
        ws.serializeAttachment(session)
        const members = this.state.getWebSockets().filter(other => other !== ws && this.session(other).joined).map(other => {
          const value = this.session(other)
          return { socketId: value.socketId, memberId: value.memberId, role: value.role, section: value.section }
        })
        this.send(ws, 'room-members', members)
        if (!alreadyJoined) this.broadcast('member-joined', { socketId: session.socketId, memberId: member.id, role: member.role, section: member.section }, ws)
        if (!this.room.scoreId) {
          const active = await this.env.DB.prepare('SELECT id, scoreId FROM Rehearsal WHERE ensembleId = ? AND endedAt IS NULL ORDER BY startedAt DESC LIMIT 1').bind(session.ensembleId).first<{ id: string; scoreId: string }>()
          if (active?.scoreId) {
            Object.assign(this.room, { scoreId: active.scoreId, rehearsalId: active.id, isRehearsing: true })
            await this.saveRoom()
          }
        }
        if (this.room.scoreId) this.send(ws, 'score-selected', { scoreId: this.room.scoreId })
        this.send(ws, 'page-changed', { page: this.room.page, scoreId: this.room.scoreId })
        if (this.room.isRehearsing) this.send(ws, 'rehearsal-started', { scoreId: this.room.scoreId, rehearsalId: this.room.rehearsalId })
        if (this.room.position) this.send(ws, 'position-updated', this.room.position)
        return
      }
      if (!session.joined) return this.error(ws, '请先加入乐团')
      if (event === 'leave-ensemble') return this.leave(ws)
      if (event === 'join-audio-room') {
        session.audioJoined = true
        ws.serializeAttachment(session)
        this.send(ws, 'audio-room-members', this.state.getWebSockets().filter(other => other !== ws && this.session(other).audioJoined).map(other => this.session(other)))
        this.broadcast('audio-member-joined', { socketId: session.socketId, memberId: session.memberId, role: session.role, section: session.section }, ws, undefined, true)
        return
      }
      if (event === 'leave-audio-room') {
        session.audioJoined = false
        ws.serializeAttachment(session)
        this.broadcast('audio-member-left', { socketId: session.socketId, memberId: session.memberId }, ws, undefined, true)
        return
      }
      if (['webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate'].includes(event)) {
        const target = this.state.getWebSockets().find(other => this.session(other).socketId === data?.to && this.session(other).audioJoined && this.session(other).joined && this.session(other).ensembleId === session.ensembleId)
        if (session.audioJoined && target) this.send(target, event, { from: session.socketId, signal: data.signal, memberId: session.memberId, role: session.role, section: session.section })
        return
      }
      if (event === 'cursor-move') return this.broadcast('cursor-moved', { ...data, memberId: session.memberId, role: session.role }, ws)
      if (session.role !== 'CONDUCTOR' && !['add-mark', 'delete-mark'].includes(event)) return this.error(ws, '只有指挥可以控制排练')
      switch (event) {
        case 'add-mark': {
          if (!data || !['DRAWING', 'TEXT', 'HIGHLIGHT'].includes(data.type) || typeof data.data !== 'string' || data.data.length > 1000000 || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 0 || data.y < 0 || !Number.isInteger(data.page) || data.page < 1) return this.error(ws, '标记数据无效')
          const score = await this.env.DB.prepare('SELECT id FROM Score WHERE id = ? AND ensembleId = ?').bind(data.scoreId, session.ensembleId).first()
          if (!score) return this.error(ws, '乐谱不存在')
          const target = session.role === 'CONDUCTOR' ? await this.targets(data, session) : { targetSection: undefined, targetMemberId: undefined }
          const mark = { id: crypto.randomUUID(), type: data.type, data: data.data, x: data.x, y: data.y, width: Number.isFinite(data.width) && data.width >= 0 ? data.width : null, height: Number.isFinite(data.height) && data.height >= 0 ? data.height : null, page: data.page, scoreId: data.scoreId, creatorId: session.memberId, targetSection: target.targetSection || null, targetMemberId: target.targetMemberId || null, private: session.role !== 'CONDUCTOR' || data.private === true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          await this.env.DB.prepare('INSERT INTO Mark (id, type, data, x, y, width, height, page, scoreId, creatorId, targetSection, targetMemberId, private, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(mark.id, mark.type, mark.data, mark.x, mark.y, mark.width, mark.height, mark.page, mark.scoreId, mark.creatorId, mark.targetSection, mark.targetMemberId, mark.private ? 1 : 0, mark.createdAt, mark.updatedAt).run()
          this.visibleBroadcast('mark-added', mark, targetSession => canSeeMark(mark, this.viewer(targetSession)))
          break
        }
        case 'delete-mark': {
          const mark = typeof data === 'string' ? await this.env.DB.prepare('SELECT Mark.* FROM Mark JOIN Score ON Score.id = Mark.scoreId WHERE Mark.id = ? AND Score.ensembleId = ?').bind(data, session.ensembleId).first<any>() : null
          if (!mark || (session.role !== 'CONDUCTOR' && mark.creatorId !== session.memberId)) return this.error(ws, '不能删除此标记')
          await this.env.DB.prepare('DELETE FROM Mark WHERE id = ?').bind(data).run()
          this.visibleBroadcast('mark-deleted', data, targetSession => canSeeMark(mark, this.viewer(targetSession)))
          break
        }
        case 'send-cue': {
          if (!data || !['CLICK', 'COUNT_IN', 'METRONOME', 'DEMO_AUDIO'].includes(data.type)) return this.error(ws, '提示数据无效')
          const scoreId = text(data.scoreId, 200) || this.room.scoreId
          if (scoreId && !await this.env.DB.prepare('SELECT id FROM Score WHERE id = ? AND ensembleId = ?').bind(scoreId, session.ensembleId).first()) return this.error(ws, '乐谱不存在')
          if (data.bpm !== undefined && (!Number.isFinite(data.bpm) || data.bpm < 20 || data.bpm > 400)) return this.error(ws, '速度无效')
          const cue = { ...data, ...await this.targets(data, session), private: false, id: crypto.randomUUID(), timestamp: Date.now(), scoreId, currentMeasure: data.currentMeasure || data.measureNumber || this.room.position?.measure || 1, fromConductor: true }
          await this.persistEvent('CUE_SENT', cue, session)
          this.visibleBroadcast('cue-received', cue, targetSession => canReceiveTarget(cue, this.viewer(targetSession)))
          break
        }
        case 'send-mistake': {
          if (!data || !text(data.kind, 100) || !Number.isInteger(data.measure) || data.measure < 1) return this.error(ws, '错音反馈数据无效')
          const scoreId = text(data.scoreId, 200) || this.room.scoreId
          if (!scoreId || !await this.env.DB.prepare('SELECT id FROM Score WHERE id = ? AND ensembleId = ?').bind(scoreId, session.ensembleId).first()) return this.error(ws, '乐谱不存在')
          const report = { ...await this.targets(data, session), scoreId, measure: data.measure, kind: text(data.kind, 100), note: text(data.note, 2000) || '', reporterId: session.memberId, id: crypto.randomUUID(), timestamp: Date.now() }
          await this.persistEvent('MISTAKE_REPORTED', report, session)
          this.visibleBroadcast('mistake-received', report, targetSession => canReceiveTarget(report, this.viewer(targetSession)))
          break
        }
        case 'score-select': {
          const score = await this.env.DB.prepare('SELECT id FROM Score WHERE id = ? AND ensembleId = ?').bind(data?.scoreId || '', session.ensembleId).first()
          if (!score) return this.error(ws, '乐谱不存在')
          if (this.room.scoreId !== data.scoreId) Object.assign(this.room, { scoreId: data.scoreId, page: 1, position: undefined })
          await this.saveRoom()
          this.broadcast('score-selected', { scoreId: data.scoreId })
          this.broadcast('page-changed', { page: this.room.page, scoreId: data.scoreId })
          break
        }
        case 'page-change': {
          const page = typeof data === 'number' ? data : data?.page
          if (!Number.isInteger(page) || page < 1) return this.error(ws, '页码无效')
          this.room.page = page
          await this.saveRoom()
          this.broadcast('page-changed', { page, scoreId: this.room.scoreId }, ws)
          break
        }
        case 'rehearsal-start': {
          const rehearsal = await this.env.DB.prepare('SELECT id, scoreId FROM Rehearsal WHERE id = ? AND scoreId = ? AND ensembleId = ? AND endedAt IS NULL').bind(data?.rehearsalId || '', data?.scoreId || '', session.ensembleId).first<{ id: string; scoreId: string }>()
          if (!rehearsal) return this.error(ws, '排练记录不存在')
          Object.assign(this.room, { scoreId: rehearsal.scoreId, rehearsalId: rehearsal.id, isRehearsing: true, page: this.room.scoreId === rehearsal.scoreId ? this.room.page : 1 })
          await this.saveRoom()
          this.broadcast('rehearsal-started', { scoreId: rehearsal.scoreId, rehearsalId: rehearsal.id })
          break
        }
        case 'rehearsal-stop':
          Object.assign(this.room, { isRehearsing: false, rehearsalId: undefined })
          await this.saveRoom()
          if (this.room.position) this.room.position = { ...this.room.position, running: false }
          await this.saveRoom()
          this.broadcast('rehearsal-stopped', undefined)
          if (this.room.position) this.broadcast('position-updated', this.room.position)
          break
        case 'current-position': {
          const position = validatePosition(data, this.room.scoreId)
          if (!position.scoreId || !await this.env.DB.prepare('SELECT id FROM Score WHERE id = ? AND ensembleId = ?').bind(position.scoreId, session.ensembleId).first()) return this.error(ws, '乐谱不存在')
          this.room.position = { ...(this.room.position?.scoreId === position.scoreId ? this.room.position : {}), ...position, memberId: session.memberId }
          await this.saveRoom()
          this.broadcast('position-updated', this.room.position)
          break
        }
        case 'audio-control':
        case 'send-cue-audio':
          for (const target of this.state.getWebSockets()) {
            const value = this.session(target)
            if (target === ws || !value.joined || (event === 'send-cue-audio' && !value.audioJoined) || (data.targetMemberId && data.targetMemberId !== value.memberId) || (data.targetSection && data.targetSection !== value.section)) continue
            this.send(target, event === 'audio-control' ? event : 'cue-audio', { ...data, fromConductor: true, timestamp: Date.now() })
          }
          break
        default: this.error(ws, '不支持的操作')
      }
    } catch (error) {
      console.error('Realtime operation failed:', error instanceof Error ? error.message : 'unknown error')
      this.error(ws, error instanceof FeatureError ? error.message : '操作失败，请重试')
    }
  }
  webSocketClose(ws: WebSocket): Promise<void> {
    this.queue = this.queue.then(() => { this.leave(ws); try { ws.close(1000, 'Disconnected') } catch {} })
    return this.queue
  }
  webSocketError(ws: WebSocket): Promise<void> {
    this.queue = this.queue.then(() => { this.leave(ws); try { ws.close(1011, 'Connection error') } catch {} })
    return this.queue
  }
}
