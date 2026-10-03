import type { RealtimeSocket } from '../utils/workerSocket'
import type { User } from '../types'
import { audioEngine } from './audioEngine'

export interface AudioPeer { socketId: string; memberId: string; role: string; section?: string }
export interface PeerHealth { memberId: string; section?: string; state: RTCPeerConnectionState; rttMs?: number; jitterMs?: number; bufferMs?: number; relay?: boolean }
type Signal = AudioPeer & { from: string; signal: RTCSessionDescriptionInit & RTCIceCandidateInit }
type Peer = { info: AudioPeer; connection: RTCPeerConnection; sender?: RTCRtpSender; candidates: RTCIceCandidateInit[]; disconnectSource?: () => void }

export function iceServers(raw = import.meta.env?.VITE_ICE_SERVERS as string | undefined): RTCIceServer[] {
  if (!raw) return [{ urls: 'stun:stun.l.google.com:19302' }]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some(server => !server || typeof server !== 'object' || !('urls' in server))) throw new Error()
    return parsed as RTCIceServer[]
  } catch { throw new Error('VITE_ICE_SERVERS 必须是有效的 ICE 服务器 JSON 数组') }
}

export class LiveAudioSession {
  private peers = new Map<string, Peer>()
  private members = new Map<string, AudioPeer>()
  private localStream?: MediaStream
  private target: { section?: string; memberId?: string } = {}
  private listeners: Array<[string, (data: any) => void]> = []
  private statsTimer: ReturnType<typeof setInterval>
  private stopped = false
  private enabled = false
  private pendingOffers = new Set<string>()

  constructor(private socket: RealtimeSocket, private user: User, private onHealth: (stats: PeerHealth[]) => void, private onError: (error: string) => void) {
    this.listen('audio-room-members', members => {
      this.members = new Map((members as AudioPeer[]).map(member => [member.socketId, member]))
      for (const id of this.peers.keys()) if (!this.members.has(id)) this.closePeer(id)
      if (this.localStream && this.enabled) for (const member of this.members.values()) void this.offer(member)
    })
    this.listen('audio-member-joined', member => {
      this.members.set(member.socketId, member)
      if (this.localStream && this.enabled) void this.offer(member)
    })
    this.listen('audio-member-left', member => { this.members.delete(member.socketId); this.closePeer(member.socketId) })
    this.listen('disconnect', () => { for (const id of this.peers.keys()) this.closePeer(id); this.members.clear() })
    this.listen('webrtc-offer', (data: Signal) => void this.answer(data).catch(error => this.fail(error)))
    this.listen('webrtc-answer', (data: Signal) => void this.acceptAnswer(data).catch(error => this.fail(error)))
    this.listen('webrtc-ice-candidate', (data: Signal) => void this.candidate(data).catch(error => this.fail(error)))
    this.statsTimer = setInterval(() => void this.stats(), 2000)
  }

  private listen(event: string, handler: (data: any) => void) { this.socket.on(event, handler); this.listeners.push([event, handler]) }
  private fail(error: unknown) { if (!this.stopped) this.onError(error instanceof Error ? error.message : '实时音频连接失败') }
  private matches(member: AudioPeer) { return member.role === 'PLAYER' && (!this.target.section || this.target.section === member.section) && (!this.target.memberId || this.target.memberId === member.memberId) }

  async enableListening() {
    await audioEngine.unlock()
    if (this.stopped) return
    this.enabled = true
  }

  async startMicrophone() {
    if (this.user.role !== 'CONDUCTOR') return
    const stream = await audioEngine.microphone('live')
    if (this.stopped) { audioEngine.releaseMicrophone('live'); return }
    this.localStream = stream
    this.enabled = true
    for (const member of this.members.values()) await this.offer(member)
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => this.stopMicrophone(), { once: true }))
  }

  stopMicrophone() {
    this.localStream = undefined
    for (const peer of this.peers.values()) void peer.sender?.replaceTrack(null).catch(error => this.fail(error))
    audioEngine.releaseMicrophone('live')
  }

  async setTarget(section?: string, memberId?: string) {
    this.target = { section, memberId }
    for (const peer of this.peers.values()) if (peer.sender) await peer.sender.replaceTrack(this.matches(peer.info) ? this.localStream?.getAudioTracks()[0] || null : null)
    if (this.localStream) for (const member of this.members.values()) await this.offer(member)
  }

  private createPeer(info: AudioPeer) {
    const existing = this.peers.get(info.socketId)
    if (existing) return existing
    const connection = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle' })
    const peer: Peer = { info, connection, candidates: [] }
    if (this.user.role === 'CONDUCTOR') {
      const transceiver = connection.addTransceiver('audio', { direction: 'sendonly' })
      peer.sender = transceiver.sender
    }
    connection.onicecandidate = event => { if (event.candidate && !this.stopped) this.socket.emit('webrtc-ice-candidate', { to: info.socketId, signal: event.candidate.toJSON() }) }
    connection.ontrack = event => {
      if (this.user.role !== 'PLAYER' || info.role !== 'CONDUCTOR' || !this.enabled) return
      const stream = event.streams[0] || new MediaStream([event.track])
      peer.disconnectSource?.()
      peer.disconnectSource = audioEngine.connectRemote(stream)
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') this.onError('实时音频无法连接。跨网络使用时，请配置 TURN 中继服务器后重连')
      void this.stats()
    }
    this.peers.set(info.socketId, peer)
    return peer
  }

  private async offer(info: AudioPeer) {
    if (this.stopped || this.user.role !== 'CONDUCTOR' || info.role !== 'PLAYER' || !this.localStream || this.pendingOffers.has(info.socketId)) return
    this.pendingOffers.add(info.socketId)
    try {
      const peer = this.createPeer(info)
      if (peer.connection.signalingState !== 'stable') return
      await peer.sender!.replaceTrack(this.matches(info) ? this.localStream.getAudioTracks()[0] : null)
      if (peer.connection.currentRemoteDescription) return
      await peer.connection.setLocalDescription(await peer.connection.createOffer())
      if (!this.stopped) this.socket.emit('webrtc-offer', { to: info.socketId, signal: peer.connection.localDescription!.toJSON() })
    } catch (error) { this.fail(error) } finally { this.pendingOffers.delete(info.socketId) }
  }

  private async answer(data: Signal) {
    if (!this.enabled || this.user.role !== 'PLAYER' || data.role !== 'CONDUCTOR' || data.signal?.type !== 'offer') return
    const peer = this.createPeer({ socketId: data.from, memberId: data.memberId, role: data.role, section: data.section })
    await peer.connection.setRemoteDescription(data.signal)
    await this.flushCandidates(peer)
    await peer.connection.setLocalDescription(await peer.connection.createAnswer())
    if (!this.stopped) this.socket.emit('webrtc-answer', { to: data.from, signal: peer.connection.localDescription!.toJSON() })
  }

  private async acceptAnswer(data: Signal) {
    const peer = this.peers.get(data.from)
    if (!peer || this.user.role !== 'CONDUCTOR' || peer.connection.signalingState !== 'have-local-offer' || data.signal?.type !== 'answer') return
    await peer.connection.setRemoteDescription(data.signal)
    await this.flushCandidates(peer)
  }

  private async candidate(data: Signal) {
    if (!data.signal?.candidate) return
    let peer = this.peers.get(data.from)
    if (!peer && this.enabled && this.user.role === 'PLAYER' && data.role === 'CONDUCTOR') peer = this.createPeer({ socketId: data.from, memberId: data.memberId, role: data.role, section: data.section })
    if (!peer) return
    if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(data.signal)
    else peer.candidates.push(data.signal)
  }

  private async flushCandidates(peer: Peer) { for (const candidate of peer.candidates.splice(0)) await peer.connection.addIceCandidate(candidate) }
  private closePeer(id: string) { const peer = this.peers.get(id); peer?.disconnectSource?.(); if (peer) { peer.connection.onconnectionstatechange = null; peer.connection.close() }; this.peers.delete(id) }

  async stats() {
    const health = await Promise.all([...this.peers.values()].map(async peer => {
      const result: PeerHealth = { memberId: peer.info.memberId, section: peer.info.section, state: peer.connection.connectionState }
      if (result.state === 'closed') return result
      try {
        const reports = await peer.connection.getStats()
        reports.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
            if (typeof report.currentRoundTripTime === 'number') result.rttMs = report.currentRoundTripTime * 1000
            const local = reports.get(report.localCandidateId)
            const remote = reports.get(report.remoteCandidateId)
            result.relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay'
          }
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            if (typeof report.jitter === 'number') result.jitterMs = report.jitter * 1000
            if (report.jitterBufferEmittedCount > 0) result.bufferMs = report.jitterBufferDelay / report.jitterBufferEmittedCount * 1000
          }
        })
      } catch { /* A peer can close between polling and getStats. */ }
      return result
    }))
    if (!this.stopped) this.onHealth(health)
  }

  stop() {
    this.stopped = true
    this.enabled = false
    clearInterval(this.statsTimer)
    for (const [event, handler] of this.listeners) this.socket.off(event, handler)
    for (const id of this.peers.keys()) this.closePeer(id)
    this.stopMicrophone()
  }
}
