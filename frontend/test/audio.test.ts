import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LiveAudioSession, iceServers, type PeerHealth } from '../src/audio/LiveAudioSession'
import { audioEngine } from '../src/audio/audioEngine'
import { acceptsCue, appendCue, readCue } from '../src/audio/cueHistory'
import type { RealtimeSocket } from '../src/utils/workerSocket'

class Socket implements RealtimeSocket {
  id = 'self'
  connected = true
  handlers = new Map<string, Set<(data?: any) => void>>()
  emitted: Array<{ event: string; data: any }> = []
  on(event: string, handler: (data?: any) => void) { const callbacks = this.handlers.get(event) || new Set(); callbacks.add(handler); this.handlers.set(event, callbacks) }
  off(event: string, handler?: (data?: any) => void) { if (handler) this.handlers.get(event)?.delete(handler); else this.handlers.delete(event) }
  emit(event: string, data?: any) { this.emitted.push({ event, data }) }
  receive(event: string, data?: any) { this.handlers.get(event)?.forEach(callback => callback(data)) }
  disconnect() { this.connected = false }
}

class PeerConnection {
  static created: PeerConnection[] = []
  signalingState = 'stable'
  connectionState = 'connected'
  localDescription: { type: string; toJSON: () => { type: string; sdp: string } } | null = null
  remoteDescription: unknown
  currentRemoteDescription: unknown
  candidates: unknown[] = []
  track: unknown
  onicecandidate: unknown
  ontrack: ((event: { track: unknown; streams: unknown[] }) => void) | null = null
  onconnectionstatechange: unknown
  constructor() { PeerConnection.created.push(this) }
  addTransceiver() { return { sender: { replaceTrack: async (track: unknown) => { this.track = track } } } }
  async createOffer() { return { type: 'offer', sdp: 'mock' } }
  async createAnswer() { return { type: 'answer', sdp: 'mock' } }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = { ...description, toJSON: () => description }
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(description: { type: string }) {
    this.remoteDescription = description
    this.currentRemoteDescription = description
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
  }
  async addIceCandidate(candidate: unknown) { this.candidates.push(candidate) }
  async getStats() { return new Map([
    ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.012, localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: 'host' }], ['remote', { candidateType: 'relay' }],
    ['inbound', { type: 'inbound-rtp', kind: 'audio', jitter: 0.004, jitterBufferDelay: 0.8, jitterBufferEmittedCount: 100 }],
  ]) }
  close() { this.connectionState = 'closed'; this.signalingState = 'closed' }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5))

test('cue history decodes persisted events and enforces personal and section recipients', () => {
  const cue = readCue({ type: 'CUE_SENT', timestamp: '2026-10-03T10:00:00.000Z', data: JSON.stringify({ type: 'COUNT_IN', targetSection: 'cello', targetMemberId: 'cellist', bpm: 80 }) })!
  assert.equal(cue.type, 'COUNT_IN')
  assert.equal(cue.timestamp, Date.parse('2026-10-03T10:00:00.000Z'))
  assert.equal(acceptsCue(cue, { id: 'cellist', role: 'PLAYER', section: 'cello' }), true)
  assert.equal(acceptsCue(cue, { id: 'other', role: 'PLAYER', section: 'cello' }), false)
  assert.equal(acceptsCue(cue, { id: 'cellist', role: 'PLAYER', section: 'violin1' }), false)
  assert.equal(acceptsCue(cue, { id: 'conductor', role: 'CONDUCTOR' }), true)
  assert.equal(readCue({ data: '{invalid' }), null)
  assert.equal(appendCue([cue], cue).length, 1)
})

test('ICE configuration accepts deployment TURN and rejects malformed JSON', () => {
  assert.deepEqual(iceServers('[{"urls":"turn:relay.example.com:3478","username":"a","credential":"b"}]'), [{ urls: 'turn:relay.example.com:3478', username: 'a', credential: 'b' }])
  assert.throws(() => iceServers('{broken'), /VITE_ICE_SERVERS/)
})

test('live WebRTC applies section/member routing, queues ICE, measures actual stats, and cleans reconnect peers', async () => {
  const oldPeer = globalThis.RTCPeerConnection
  const oldUnlock = audioEngine.unlock
  const oldMicrophone = audioEngine.microphone
  const oldRelease = audioEngine.releaseMicrophone
  const oldRemote = audioEngine.connectRemote
  const track = { readyState: 'live', addEventListener() {} }
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
  let released = 0
  let remoteConnections = 0
  globalThis.RTCPeerConnection = PeerConnection as unknown as typeof RTCPeerConnection
  audioEngine.unlock = async () => ({ state: 'running' } as AudioContext)
  audioEngine.microphone = async () => stream
  audioEngine.releaseMicrophone = () => { released++ }
  audioEngine.connectRemote = () => { remoteConnections++; return () => { remoteConnections-- } }
  PeerConnection.created = []
  const conductorSocket = new Socket()
  const playerSocket = new Socket()
  let health: PeerHealth[] = []
  const failures: string[] = []
  const conductor = new LiveAudioSession(conductorSocket, { id: 'c', name: '指挥', role: 'CONDUCTOR' }, value => { health = value }, error => failures.push(error))
  const player = new LiveAudioSession(playerSocket, { id: 'p', name: '乐手', role: 'PLAYER', section: 'cello' }, () => {}, error => failures.push(error))
  try {
    const cello = { socketId: 'p-socket', memberId: 'p', role: 'PLAYER', section: 'cello' }
    const violin = { socketId: 'v-socket', memberId: 'v', role: 'PLAYER', section: 'violin1' }
    conductorSocket.receive('audio-room-members', [cello, violin])
    await conductor.setTarget('cello')
    await conductor.startMicrophone()
    const [celloPeer, violinPeer] = PeerConnection.created
    assert.equal(celloPeer.track, track)
    assert.equal(violinPeer.track, null, 'unselected section receives no microphone track')
    await conductor.setTarget(undefined, 'v')
    assert.equal(celloPeer.track, null)
    assert.equal(violinPeer.track, track)
    await player.enableListening()
    const fromConductor = { from: 'c-socket', memberId: 'c', role: 'CONDUCTOR' }
    playerSocket.receive('webrtc-ice-candidate', { ...fromConductor, signal: { candidate: 'early-ice' } })
    const receiver = PeerConnection.created.at(-1)!
    assert.equal(receiver.candidates.length, 0)
    playerSocket.receive('webrtc-offer', { ...fromConductor, signal: { type: 'offer', sdp: 'audio' } })
    await settle()
    assert.equal(receiver.candidates.length, 1)
    assert.equal(playerSocket.emitted.at(-1)?.event, 'webrtc-answer')
    receiver.ontrack?.({ track, streams: [stream] })
    assert.equal(remoteConnections, 1)
    const count = PeerConnection.created.length
    playerSocket.receive('webrtc-offer', { from: 'malicious', memberId: 'v', role: 'PLAYER', signal: { type: 'offer', sdp: 'audio' } })
    await settle()
    assert.equal(PeerConnection.created.length, count, 'players cannot inject an audio source')
    await conductor.stats()
    assert.equal(health[0].rttMs, 12)
    assert.equal(health[0].jitterMs, 4)
    assert.equal(health[0].bufferMs, 8)
    assert.equal(health[0].relay, true)
    playerSocket.receive('disconnect')
    assert.equal(receiver.connectionState, 'closed')
    assert.equal(remoteConnections, 0)
    conductorSocket.receive('disconnect')
    assert.equal(celloPeer.connectionState, 'closed')
    conductorSocket.receive('audio-room-members', [cello])
    await settle()
    assert.notEqual(PeerConnection.created.at(-1), celloPeer, 'reconnect makes fresh peer connections')
    assert.deepEqual(failures, [])
  } finally {
    conductor.stop()
    player.stop()
    globalThis.RTCPeerConnection = oldPeer
    audioEngine.unlock = oldUnlock
    audioEngine.microphone = oldMicrophone
    audioEngine.releaseMicrophone = oldRelease
    audioEngine.connectRemote = oldRemote
  }
  assert.ok(released > 0)
  assert.equal([...playerSocket.handlers.values()].some(callbacks => callbacks.size), false)
})
