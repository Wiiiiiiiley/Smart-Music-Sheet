import { useEffect, useRef, useState } from 'react'
import { Volume2, Timer, Music, Square } from 'lucide-react'
import { useSocketStore } from '../../stores/socketStore'
import { useAppStore } from '../../stores/appStore'
import { audioEngine, type PlaybackCue } from '../../audio/audioEngine'
import { acceptsCue, cueLabels, readCue } from '../../audio/cueHistory'

const icons = { CLICK: Volume2, COUNT_IN: Timer, METRONOME: Timer, DEMO_AUDIO: Music }

export default function CueReceiver() {
  const { socket, setupEventListeners } = useSocketStore()
  const { masterVolume, sectionVolumes } = useAppStore()
  const [activeCue, setActiveCue] = useState<PlaybackCue | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [error, setError] = useState('')
  const soundReady = useRef(false)
  const cueTimer = useRef<ReturnType<typeof setTimeout>>()
  const pending = useRef<PlaybackCue | null>(null)

  const play = async (cue: PlaybackCue) => {
    setError('')
    try { await audioEngine.playCue(cue, () => setActiveCue(null)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '音频播放失败') }
  }

  useEffect(() => setupEventListeners({
    onCueReceived: raw => {
      const cue = readCue(raw)
      if (!cue || !acceptsCue(cue, useAppStore.getState().currentUser)) return
      clearTimeout(cueTimer.current)
      setActiveCue(cue)
      pending.current = cue
      if (soundReady.current || audioEngine.context?.state === 'running') void play(cue)
      if (cue.type === 'CLICK' || cue.type === 'COUNT_IN') cueTimer.current = setTimeout(() => setActiveCue(null), cue.type === 'COUNT_IN' ? Math.max(3000, 60000 * (cue.beatsPerMeasure || 4) / (cue.bpm || 120) + 200) : 3000)
    },
    onAudioControl: control => {
      if (control.action === 'STOP_CUE') { audioEngine.stopCue(); pending.current = null; setActiveCue(null); return }
      if (!['MUTE', 'UNMUTE', 'SET_VOLUME'].includes(control.action)) return
      const state = useAppStore.getState()
      const volume = control.action === 'MUTE' ? 0 : control.action === 'UNMUTE' ? 1 : typeof control.volume === 'number' ? Math.max(0, Math.min(1, control.volume)) : 1
      state.setSectionVolume(control.channel === 'demo' ? 'demo' : 'live', volume)
    },
    onRehearsalStopped: () => { audioEngine.stopCue(); pending.current = null; setActiveCue(null) },
  }), [socket, setupEventListeners])

  useEffect(() => { audioEngine.setVolumes(masterVolume, sectionVolumes) }, [masterVolume, sectionVolumes])
  useEffect(() => () => { audioEngine.stopCue(); clearTimeout(cueTimer.current) }, [])

  const enable = async () => {
    try {
      await audioEngine.unlock()
      soundReady.current = true
      setSoundEnabled(true)
      setError('')
      if (pending.current) await play(pending.current)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '浏览器无法启用声音，请检查音频权限') }
  }

  const Icon = activeCue ? icons[activeCue.type] : Volume2
  return <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 max-w-[95vw]">
    {!soundEnabled && <button className="bg-white border border-primary-200 text-primary-700 px-4 py-2 rounded-full shadow text-sm" onClick={() => void enable()}><Volume2 className="inline w-4 h-4 mr-2" />启用提示音</button>}
    {error && <p role="alert" className="bg-red-50 text-red-700 text-sm rounded px-3 py-1">{error}</p>}
    {activeCue && <div className="bg-primary-600 text-white px-5 py-3 rounded-full shadow-lg flex items-center gap-3">
      <Icon className="w-5 h-5" /><span className="font-medium whitespace-nowrap">{cueLabels[activeCue.type]}</span>
      {activeCue.bpm && <span className="text-sm">{activeCue.bpm} BPM</span>}
      <button aria-label="停止提示音" onClick={() => { audioEngine.stopCue(); pending.current = null; setActiveCue(null) }}><Square className="w-4 h-4" /></button>
    </div>}
  </div>
}
