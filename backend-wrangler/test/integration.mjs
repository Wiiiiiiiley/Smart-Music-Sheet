import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const workerDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(path.join(tmpdir(), 'edutempo-worker-test-'))
let mf
const clients = []
function client(ws) {
  const buffered = new Map()
  const waiting = new Map()
  ws.addEventListener('message', message => {
    const frame = JSON.parse(message.data)
    const listener = waiting.get(frame.event)?.shift()
    if (listener) listener(frame.data)
    else buffered.set(frame.event, [...(buffered.get(frame.event) || []), frame.data])
  })
  return {
    ws,
    emit(event, data) { ws.send(JSON.stringify({ event, data })) },
    async event(name) {
      const frames = buffered.get(name)
      if (frames?.length) return frames.shift()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000)
        const callback = data => { clearTimeout(timer); resolve(data) }
        waiting.set(name, [...(waiting.get(name) || []), callback])
      })
    },
    buffered
  }
}
try {
  const bundle = path.join(directory, 'worker.mjs')
  await build({ entryPoints: [path.join(workerDirectory, 'src/index.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
  mf = new Miniflare({ modules: true, rootPath: directory, modulesRoot: directory, scriptPath: bundle, compatibilityDate: '2024-01-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], r2Buckets: ['UPLOADS'], durableObjects: { WEBSOCKET: { className: 'WebSocketServer', useSQLite: true } } })
  const database = await mf.getD1Database('DB')
  for (const migration of (await readdir(path.join(workerDirectory, 'migrations'))).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(path.join(workerDirectory, 'migrations', migration), 'utf8')
    await database.batch(sql.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => database.prepare(statement)))
  }
  async function json(url, method = 'GET', data, status = 200) {
    const response = await mf.dispatchFetch(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })
    assert.equal(response.status, status, `${method} ${url}: ${await response.clone().text()}`)
    return response.json()
  }
  async function memberSocket(ensemble, member) {
    const response = await mf.dispatchFetch(`http://localhost/ws?ensembleId=${ensemble.id}&userId=${member.id}`, { headers: { Upgrade: 'websocket' } })
    assert.equal(response.status, 101)
    const result = client(response.webSocket)
    clients.push(result)
    result.ws.accept()
    const connected = await result.event('connected')
    result.socketId = connected.socketId
    result.emit('join-ensemble', { ensembleId: ensemble.id, memberId: member.id })
    await result.event('room-members')
    return result
  }
  const ensemble = await json('/api/ensembles', 'POST', { name: 'Worker 乐团', conductorId: 'worker-conductor', conductorName: 'Worker 指挥' }, 201)
  const violin = await json(`/api/ensembles/${ensemble.id}/members`, 'POST', { id: 'worker-violin', name: 'Violin', section: 'violin1' }, 201)
  const cello = await json(`/api/ensembles/${ensemble.id}/members`, 'POST', { id: 'worker-cello', name: 'Cello', section: 'cello' }, 201)
  const conductor = await memberSocket(ensemble, ensemble.members[0])
  const violinSocket = await memberSocket(ensemble, violin)
  const celloSocket = await memberSocket(ensemble, cello)
  const form = new FormData()
  const contents = '%PDF-1.7\nworker test data'
  form.append('score', new Blob([contents], { type: 'application/pdf' }), 'test.pdf')
  const response = await mf.dispatchFetch('http://localhost/api/upload/both', { method: 'POST', body: form })
  assert.equal(response.status, 200)
  const uploaded = await response.json()
  assert.match(uploaded.score.fileUrl, /^http:\/\/localhost\/api\/upload\/files\/scores\//)
  assert.equal(await (await mf.dispatchFetch(uploaded.score.fileUrl)).text(), contents)
  const rangeResponse = await mf.dispatchFetch(uploaded.score.fileUrl, { headers: { Range: 'bytes=0-7' } })
  assert.equal(rangeResponse.status, 206)
  assert.equal(await rangeResponse.text(), contents.slice(0, 8))
  const score = await json('/api/scores', 'POST', { title: 'Worker 乐谱', fileUrl: uploaded.score.fileUrl, fileType: 'pdf', ensembleId: ensemble.id }, 201)
  conductor.emit('score-select', { scoreId: score.id })
  assert.equal((await violinSocket.event('score-selected')).scoreId, score.id)
  assert.equal((await violinSocket.event('page-changed')).page, 1)
  const selectedPage = await violinSocket.event('page-changed')
  assert.equal(selectedPage.page, 1)
  assert.equal(selectedPage.scoreId, score.id)
  conductor.emit('add-mark', { scoreId: score.id, type: 'TEXT', data: '注意节奏', x: 0.2, y: 0.3, page: 1, targetSection: 'violin1' })
  const ownMark = await conductor.event('mark-added')
  const mark = await violinSocket.event('mark-added')
  assert.equal(ownMark.id, mark.id)
  assert.equal((await json(`/api/scores/${score.id}/marks?memberId=${violin.id}`)).length, 1)
  assert.equal((await json(`/api/scores/${score.id}/marks?memberId=${cello.id}`)).length, 0)
  conductor.emit('send-cue', { type: 'COUNT_IN', bpm: 90, targetSection: 'violin1' })
  assert.equal((await violinSocket.event('cue-received')).bpm, 90)
  violinSocket.emit('send-cue', { type: 'CLICK' })
  assert.match((await violinSocket.event('error')).message, /指挥/)
  const rehearsal = await json('/api/rehearsals/start', 'POST', { ensembleId: ensemble.id, scoreId: score.id }, 201)
  conductor.emit('rehearsal-start', { rehearsalId: rehearsal.id, scoreId: score.id })
  assert.equal((await violinSocket.event('rehearsal-started')).rehearsalId, rehearsal.id)
  const late = await memberSocket(ensemble, cello)
  assert.equal((await late.event('rehearsal-started')).scoreId, score.id)
  conductor.emit('page-change', 2)
  const pageUpdate = await violinSocket.event('page-changed')
  assert.equal(pageUpdate.page, 2)
  assert.equal(pageUpdate.scoreId, score.id)
  conductor.emit('score-select', { scoreId: score.id })
  await violinSocket.event('score-selected')
  const reconnected = await memberSocket(ensemble, cello)
  assert.equal((await reconnected.event('page-changed')).page, 2)
  await conductor.event('rehearsal-started')
  conductor.emit('rehearsal-start', { rehearsalId: rehearsal.id, scoreId: score.id })
  await conductor.event('rehearsal-started')
  reconnected.emit('join-ensemble', { ensembleId: ensemble.id, memberId: cello.id })
  assert.equal((await reconnected.event('page-changed')).page, 2)
  conductor.emit('delete-mark', mark.id)
  assert.equal(await conductor.event('mark-deleted'), mark.id)
  assert.equal((await json(`/api/scores/${score.id}/marks`)).length, 0)
  violinSocket.ws.close(1000)
  assert.equal((await conductor.event('member-left')).socketId, violinSocket.socketId)
  await json(`/api/rehearsals/${rehearsal.id}/end`, 'POST', {})
  conductor.emit('rehearsal-stop')
  await conductor.event('rehearsal-stopped')
  assert.ok((await json(`/api/rehearsals/${rehearsal.id}`)).endedAt)
  assert.equal((await json(`/api/rehearsals/${rehearsal.id}/stats`)).eventCounts.REHEARSAL_ENDED, 1)
  assert.equal(celloSocket.buffered.get('mark-added')?.length || 0, 0)
  assert.equal(celloSocket.buffered.get('cue-received')?.length || 0, 0)
  const otherEnsemble = await json('/api/ensembles', 'POST', { name: 'Other', conductorId: 'other-conductor' }, 201)
  const outsider = await memberSocket(otherEnsemble, otherEnsemble.members[0])
  conductor.emit('send-cue', { type: 'CLICK' })
  await celloSocket.event('cue-received')
  assert.equal(outsider.buffered.get('cue-received')?.length || 0, 0)
  const { collaborationFeatures } = await import('../../backend/test/feature-contract.mjs')
  await collaborationFeatures({
    json, connect: member => memberSocket(ensemble, member), next: (socket, name) => socket.event(name),
    emit: (socket, name, data) => socket.emit(name, data),
    observe: (socket, name) => {
      const values = []
      socket.ws.addEventListener('message', message => { const frame = JSON.parse(message.data); if (frame.event === name) values.push(frame.data) })
      return values
    },
    ensemble, violin, cello, fileUrl: uploaded.score.fileUrl,
  })
  console.log('Worker integration passed: actual DO websocket, room isolation, D1 identity/marks, echo and targeted cues, late join, R2 upload/read/range, score/page sync, rehearsal history, disconnect roster.')
} finally {
  for (const entry of clients) { try { entry.ws.close(1000) } catch {} }
  if (mf) await mf.dispose()
  await rm(directory, { recursive: true, force: true })
}
