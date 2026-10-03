import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { io as connectSocket, Socket } from 'socket.io-client'

const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function event(socket: Socket, name: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 4000)
    socket.once(name, data => { clearTimeout(timer); resolve(data) })
  })
}
async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), 'edutempo-node-test-'))
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db')}`
  process.env.UPLOAD_DIR = path.join(directory, 'uploads')
  const backendDirectory = path.resolve(__dirname, '..')
  execFileSync(process.execPath, [path.join(backendDirectory, 'scripts/database.cjs')], { env: process.env, stdio: 'pipe' })
  const { httpServer, io, prisma } = await import('../src/index')
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const sockets: Socket[] = []
  async function json(url: string, method = 'GET', data?: any, status = 200) {
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
    assert.equal(response.status, status, `${method} ${url}: ${await response.clone().text()}`)
    return response.json()
  }
  async function memberSocket(ensemble: any, member: any) {
    const socket = connectSocket(origin, { transports: ['websocket'], forceNew: true })
    sockets.push(socket)
    await event(socket, 'connect')
    const roster = event(socket, 'room-members')
    socket.emit('join-ensemble', { ensembleId: ensemble.id, memberId: member.id, role: member.role, section: member.section })
    await roster
    return socket
  }
  try {
    const ensemble = await json('/api/ensembles', 'POST', { name: '测试乐团', conductorId: 'test-conductor', conductorName: '测试指挥' }, 201)
    assert.equal(ensemble.members[0].id, ensemble.conductorId)
    const violin = await json(`/api/ensembles/${ensemble.id}/members`, 'POST', { id: 'test-violin', name: 'Violin', section: 'violin1' }, 201)
    const cello = await json(`/api/ensembles/${ensemble.id}/members`, 'POST', { id: 'test-cello', name: 'Cello', section: 'cello' }, 201)
    assert.equal(violin.id, 'test-violin')
    await json(`/api/ensembles/${ensemble.id}/members`, 'POST', { id: violin.id, name: 'Violin' })
    const conductor = await memberSocket(ensemble, ensemble.members[0])
    const violinSocket = await memberSocket(ensemble, violin)
    const celloSocket = await memberSocket(ensemble, cello)
    const form = new FormData()
    const xml = '<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>'
    form.append('score', new Blob([xml], { type: 'application/xml' }), 'test.musicxml')
    const uploadResponse = await fetch(origin + '/api/upload/both', { method: 'POST', body: form })
    assert.equal(uploadResponse.status, 200)
    const upload = await uploadResponse.json() as any
    assert.equal(await (await fetch(upload.score.fileUrl)).text(), xml)
    const score = await json('/api/scores', 'POST', { title: '测试乐谱', fileUrl: upload.score.fileUrl, fileType: 'musicxml', ensembleId: ensemble.id }, 201)
    const selected = event(violinSocket, 'score-selected')
    conductor.emit('score-select', { scoreId: score.id })
    assert.equal((await selected).scoreId, score.id)
    let wrongSectionMarks = 0
    celloSocket.on('mark-added', () => wrongSectionMarks++)
    const ownMark = event(conductor, 'mark-added')
    const receivedMark = event(violinSocket, 'mark-added')
    conductor.emit('add-mark', { scoreId: score.id, type: 'TEXT', data: '注意节奏', x: 0.2, y: 0.3, page: 1, targetSection: 'violin1' })
    const [echo, mark] = await Promise.all([ownMark, receivedMark])
    assert.equal(echo.id, mark.id)
    assert.equal(mark.creatorId, ensemble.conductorId)
    assert.equal((await json(`/api/scores/${score.id}/marks?memberId=${violin.id}`)).length, 1)
    assert.equal((await json(`/api/scores/${score.id}/marks?memberId=${cello.id}`)).length, 0)
    let wrongSectionCues = 0
    celloSocket.on('cue-received', () => wrongSectionCues++)
    const cue = event(violinSocket, 'cue-received')
    conductor.emit('send-cue', { type: 'COUNT_IN', bpm: 120, targetSection: 'violin1' })
    assert.equal((await cue).bpm, 120)
    const rehearsal = await json('/api/rehearsals/start', 'POST', { ensembleId: ensemble.id, scoreId: score.id }, 201)
    const started = event(violinSocket, 'rehearsal-started')
    conductor.emit('rehearsal-start', { rehearsalId: rehearsal.id, scoreId: score.id })
    assert.equal((await started).rehearsalId, rehearsal.id)
    const late = connectSocket(origin, { transports: ['websocket'], forceNew: true })
    sockets.push(late)
    await event(late, 'connect')
    const restored = event(late, 'rehearsal-started')
    late.emit('join-ensemble', { ensembleId: ensemble.id, memberId: cello.id })
    assert.equal((await restored).scoreId, score.id)
    const changedPage = event(violinSocket, 'page-changed')
    conductor.emit('page-change', 2)
    assert.equal((await changedPage).page, 2)
    assert.equal((await changedPage).scoreId, score.id)
    const sameSelection = event(violinSocket, 'score-selected')
    conductor.emit('score-select', { scoreId: score.id })
    await sameSelection
    const reconnected = connectSocket(origin, { transports: ['websocket'], forceNew: true })
    sockets.push(reconnected)
    await event(reconnected, 'connect')
    const restoredPage = event(reconnected, 'page-changed')
    reconnected.emit('join-ensemble', { ensembleId: ensemble.id, memberId: cello.id })
    assert.equal((await restoredPage).page, 2)
    const replayed = event(conductor, 'rehearsal-started')
    conductor.emit('rehearsal-start', { rehearsalId: rehearsal.id, scoreId: score.id })
    await replayed
    const replayPage = event(reconnected, 'page-changed')
    reconnected.emit('join-ensemble', { ensembleId: ensemble.id, memberId: cello.id })
    assert.equal((await replayPage).page, 2)
    const deleted = event(conductor, 'mark-deleted')
    conductor.emit('delete-mark', mark.id)
    assert.equal(await deleted, mark.id)
    assert.equal((await json(`/api/scores/${score.id}/marks`)).length, 0)
    const denied = event(violinSocket, 'error')
    violinSocket.emit('send-cue', { type: 'CLICK' })
    assert.match((await denied).message, /指挥/)
    const left = event(conductor, 'member-left')
    const violinId = violinSocket.id
    violinSocket.disconnect()
    assert.equal((await left).socketId, violinId)
    await json(`/api/rehearsals/${rehearsal.id}/end`, 'POST', {})
    assert.ok((await json(`/api/rehearsals/${rehearsal.id}`)).endedAt)
    await json('/api/rehearsals/nonexistent/stats', 'GET', undefined, 404)
    await timeout(100)
    assert.equal(wrongSectionMarks, 0)
    assert.equal(wrongSectionCues, 0)
    const { collaborationFeatures } = await import('./feature-contract.mjs')
    await collaborationFeatures({
      json, connect: (member: any) => memberSocket(ensemble, member), next: event,
      emit: (socket: Socket, name: string, data: any) => socket.emit(name, data),
      observe: (socket: Socket, name: string) => { const values: any[] = []; socket.on(name, value => values.push(value)); return values },
      ensemble, violin, cello, fileUrl: upload.score.fileUrl,
    })
    console.log('Node integration passed: upload/read, member identity, score/page sync, persisted marks and echo, section targeting, role checks, late join, rehearsal, disconnect roster.')
  } finally {
    for (const socket of sockets) socket.disconnect()
    await new Promise<void>(resolve => io.close(() => resolve()))
    await prisma.$disconnect()
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
