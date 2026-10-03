import { resolveAssetUrl } from '../utils/api'

export interface PlaybackCue {
  type: 'CLICK' | 'COUNT_IN' | 'METRONOME' | 'DEMO_AUDIO'
  bpm?: number
  beatsPerMeasure?: number
  audioUrl?: string
  targetSection?: string
  targetMemberId?: string
  timestamp?: number
  measureNumber?: number
}

// One audio graph lets the recording contain the microphone and actual cue sounds.
// Microphone monitoring stays off so headphones do not feed the conductor's voice back.
class AudioEngine {
  context?: AudioContext
  private output?: GainNode
  private recording?: MediaStreamAudioDestinationNode
  private channels = new Map<string, GainNode>()
  private volumes: Record<string, number> = {}
  private master = 1
  private mic?: MediaStream
  private micSource?: MediaStreamAudioSourceNode
  private micConsumers = new Set<string>()
  private micRequest?: Promise<MediaStream>
  private tones = new Set<OscillatorNode>()
  private beatTimer?: ReturnType<typeof setInterval>
  private demo?: { audio: HTMLAudioElement; source: MediaElementAudioSourceNode }

  async unlock() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ latencyHint: 'interactive' })
      this.output = this.context.createGain()
      this.output.gain.value = this.master
      this.output.connect(this.context.destination)
      this.recording = this.context.createMediaStreamDestination()
      this.channels.clear()
    }
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('请在浏览器中允许声音播放')
    return this.context
  }

  channel(key: string) {
    if (!this.context || !this.output || !this.recording) throw new Error('请先启用声音')
    let gain = this.channels.get(key)
    if (!gain) {
      gain = this.context.createGain()
      gain.gain.value = this.volumes[key] ?? 1
      gain.connect(this.output)
      gain.connect(this.recording)
      this.channels.set(key, gain)
    }
    return gain
  }

  setVolumes(master: number, volumes: Record<string, number>) {
    this.master = Math.max(0, Math.min(1, master))
    this.volumes = volumes
    if (this.output) this.output.gain.value = this.master
    for (const [key, channel] of this.channels) channel.gain.value = Math.max(0, Math.min(1, volumes[key] ?? 1))
  }

  async microphone(consumer: string) {
    await this.unlock()
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('麦克风需要 HTTPS 或 localhost，并需浏览器支持')
    if (!this.mic?.getAudioTracks().some(track => track.readyState === 'live')) {
      if (!this.micRequest) this.micRequest = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, latency: 0.01 } as MediaTrackConstraints,
      }).finally(() => { this.micRequest = undefined })
      const stream = await this.micRequest
      if (this.mic !== stream) {
        this.mic = stream
        this.micSource?.disconnect()
        this.micSource = this.context!.createMediaStreamSource(stream)
        this.micSource.connect(this.recording!)
      }
    }
    this.micConsumers.add(consumer)
    return this.mic!
  }

  releaseMicrophone(consumer: string) {
    this.micConsumers.delete(consumer)
    if (!this.micConsumers.size) {
      this.mic?.getTracks().forEach(track => track.stop())
      this.micSource?.disconnect()
      this.micSource = undefined
      this.mic = undefined
    }
  }

  recordingStream() {
    if (!this.recording) throw new Error('请先启用录音')
    return this.recording.stream
  }

  connectRemote(stream: MediaStream) {
    if (!this.context) throw new Error('请先启用声音')
    const source = this.context.createMediaStreamSource(stream)
    source.connect(this.channel('live'))
    return () => source.disconnect()
  }

  connectElement(audio: HTMLAudioElement, channel: string) {
    if (!this.context) throw new Error('请先启用声音')
    const source = this.context.createMediaElementSource(audio)
    source.connect(this.channel(channel))
    return () => source.disconnect()
  }

  stopCue() {
    clearInterval(this.beatTimer)
    this.beatTimer = undefined
    if (this.demo) { this.demo.audio.pause(); this.demo.source.disconnect(); this.demo = undefined }
    for (const tone of this.tones) { try { tone.stop() } catch { /* Already finished. */ } }
    this.tones.clear()
  }

  private tick(accent: boolean, at: number) {
    const context = this.context!
    const tone = context.createOscillator()
    const gain = context.createGain()
    tone.frequency.value = accent ? 1046.5 : 784
    gain.gain.setValueAtTime(0.3, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
    tone.connect(gain)
    gain.connect(this.channel('metronome'))
    this.tones.add(tone)
    tone.onended = () => { this.tones.delete(tone); tone.disconnect(); gain.disconnect() }
    tone.start(at)
    tone.stop(at + 0.075)
  }

  async playCue(cue: PlaybackCue, onEnded?: () => void) {
    await this.unlock()
    this.stopCue()
    if (cue.type === 'DEMO_AUDIO') {
      if (!cue.audioUrl) throw new Error('没有选择示范音频')
      const audio = new Audio()
      audio.crossOrigin = 'anonymous'
      audio.src = resolveAssetUrl(cue.audioUrl)
      const source = this.context!.createMediaElementSource(audio)
      source.connect(this.channel(cue.targetSection ? `section:${cue.targetSection}` : 'demo'))
      this.demo = { audio, source }
      audio.onended = () => { source.disconnect(); if (this.demo?.audio === audio) this.demo = undefined; onEnded?.() }
      await audio.play()
      return
    }
    const interval = 60 / Math.max(30, Math.min(300, cue.bpm || 120))
    const beats = Math.max(1, Math.min(12, cue.beatsPerMeasure || 4))
    let next = this.context!.currentTime + 0.015
    let beat = 0
    const limit = cue.type === 'COUNT_IN' ? beats : cue.type === 'CLICK' ? 1 : Infinity
    const schedule = () => {
      while (next < this.context!.currentTime + 0.12 && beat < limit) {
        this.tick(beat % beats === 0, next)
        beat++
        next += interval
      }
      if (beat >= limit) { clearInterval(this.beatTimer); this.beatTimer = undefined }
    }
    schedule()
    if (beat < limit) this.beatTimer = setInterval(schedule, 25)
  }
}

export const audioEngine = new AudioEngine()
