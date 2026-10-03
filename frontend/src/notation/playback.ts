import { measureTicks, PPQ, timeline } from './model'
import type { NotationScore, TimedNote } from './model'

/** A short look-ahead scheduler keeps edits responsive and part faders live. */
export class NotationPlayback {
  private context: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private gains = new Map<string, GainNode>()
  private oscillators = new Set<OscillatorNode>()
  private startTime = 0
  private fromTick = 0
  private nextNote = 0
  private notes: TimedNote[] = []
  private score: NotationScore | null = null
  private callback: ((measure: number, stopped: boolean) => void) | null = null

  async play(score: NotationScore, fromMeasure: number, onPosition: (measure: number, stopped: boolean) => void): Promise<void> {
    this.stop()
    this.context ||= new AudioContext({ latencyHint: 'interactive' })
    await this.context.resume()
    this.score = score
    this.callback = onPosition
    this.fromTick = fromMeasure * measureTicks(score)
    this.notes = timeline(score).filter(note => note.tick + note.duration > this.fromTick)
    this.nextNote = 0
    this.startTime = this.context.currentTime + 0.05
    for (const part of score.parts) {
      const gain = this.context.createGain()
      gain.gain.value = part.muted ? 0 : part.volume * 0.1
      gain.connect(this.context.destination)
      this.gains.set(part.id, gain)
    }
    this.timer = setInterval(() => this.schedule(), 25)
    this.schedule()
  }

  setPartVolume(partId: string, volume: number, muted: boolean): void {
    const gain = this.gains.get(partId)
    if (gain && this.context) gain.gain.setTargetAtTime(muted ? 0 : volume * 0.1, this.context.currentTime, 0.015)
  }

  private schedule(): void {
    if (!this.context || !this.score) return
    const secondsPerTick = 60 / this.score.bpm / PPQ
    const elapsedTicks = Math.max(0, (this.context.currentTime - this.startTime) / secondsPerTick + this.fromTick)
    const measure = Math.min(this.score.parts[0].measures.length - 1, Math.floor(elapsedTicks / measureTicks(this.score)))
    this.callback?.(measure, false)
    while (this.nextNote < this.notes.length) {
      const note = this.notes[this.nextNote]
      const at = this.startTime + (note.tick - this.fromTick) * secondsPerTick
      if (at > this.context.currentTime + 0.15) break
      this.nextNote++
      const start = Math.max(this.context.currentTime, at)
      const end = at + note.duration * secondsPerTick
      if (end <= start || note.midi < 0 || note.midi > 127) continue
      const part = this.score.parts.find(part => part.id === note.partId)
      if (!part) continue
      const oscillator = this.context.createOscillator()
      const envelope = this.context.createGain()
      oscillator.type = part.program >= 40 && part.program <= 51 ? 'sawtooth' : part.program >= 68 ? 'sine' : 'triangle'
      oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12)
      const event = part.measures[note.measure].events.find(event => event.id === note.id)
      const finish = event?.articulation === 'staccato' ? start + (end - start) * 0.45 : end - Math.min(0.025, (end - start) * 0.05)
      const level = note.velocity / 100 * (event?.articulation === 'accent' ? 1.2 : 1)
      envelope.gain.setValueAtTime(0, start)
      envelope.gain.linearRampToValueAtTime(level, start + Math.min(0.012, (finish - start) * 0.1))
      envelope.gain.setValueAtTime(level * 0.7, Math.max(start + 0.01, finish - 0.025))
      envelope.gain.linearRampToValueAtTime(0, finish)
      oscillator.connect(envelope)
      envelope.connect(this.gains.get(note.partId)!)
      oscillator.start(start); oscillator.stop(finish + 0.01)
      this.oscillators.add(oscillator)
      oscillator.onended = () => { this.oscillators.delete(oscillator); oscillator.disconnect(); envelope.disconnect() }
    }
    if (elapsedTicks >= this.score.parts[0].measures.length * measureTicks(this.score)) this.stop()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const oscillator of this.oscillators) { try { oscillator.stop() } catch { /* already ended */ } oscillator.disconnect() }
    this.oscillators.clear()
    for (const gain of this.gains.values()) gain.disconnect()
    this.gains.clear()
    this.callback?.(-1, true)
    this.callback = null
    this.score = null
  }
  dispose(): void { this.stop(); void this.context?.close(); this.context = null }
}
