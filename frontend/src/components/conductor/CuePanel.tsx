import { useEffect, useState } from 'react'
import { Volume2, Timer, Music, Play, Users, Square } from 'lucide-react'
import { useSocketStore } from '../../stores/socketStore'
import { SECTIONS, type Score } from '../../types'
import { useAppStore } from '../../stores/appStore'
import SectionTracks, { type SectionTrack } from '../audio/SectionTracks'
import CueHistory from '../audio/CueHistory'
import { audioEngine, type PlaybackCue } from '../../audio/audioEngine'
import { readCue } from '../../audio/cueHistory'

interface CuePanelProps { selectedSection?: string | null; currentScore: Score | null }

export default function CuePanel({ selectedSection, currentScore }: CuePanelProps) {
  const { socket, sendCue, isConnected } = useSocketStore()
  const { currentMeasure, currentEnsemble, masterVolume, sectionVolumes } = useAppStore()
  const [bpm, setBpm] = useState(120)
  const [member, setMember] = useState('')
  const [reference, setReference] = useState('default')
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [receiverVolume, setReceiverVolume] = useState(1)
  const tracks = ((currentScore as (Score & { audioTracks?: SectionTrack[] }) | null)?.audioTracks || [])
  const selectedTrack = tracks.find(track => track.id === reference)
  const audioUrl = selectedTrack?.audioUrl || (reference === 'default' ? currentScore?.audioUrl : undefined)

  useEffect(() => { setMember('') }, [selectedSection])
  useEffect(() => { setReference('default') }, [currentScore?.id])
  useEffect(() => { audioEngine.setVolumes(masterVolume, sectionVolumes) }, [masterVolume, sectionVolumes])
  useEffect(() => {
    if (!socket) return
    const received = (raw: unknown) => {
      const cue = readCue(raw)
      if (!cue || !(preview || audioEngine.context?.state === 'running')) return
      void audioEngine.playCue(cue).catch(failure => setError(failure instanceof Error ? failure.message : '提示试听失败'))
    }
    const stopped = () => audioEngine.stopCue()
    socket.on('cue-received', received)
    socket.on('rehearsal-stopped', stopped)
    return () => { socket.off('cue-received', received); socket.off('rehearsal-stopped', stopped); audioEngine.stopCue() }
  }, [socket, preview])

  const enablePreview = async () => {
    try { await audioEngine.unlock(); setPreview(true); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '浏览器无法启用声音') }
  }

  const send = (type: PlaybackCue['type']) => sendCue({
    type, targetSection: member ? undefined : selectedSection || undefined,
    targetMemberId: member || undefined, bpm, measureNumber: currentMeasure,
    audioUrl: type === 'DEMO_AUDIO' ? audioUrl : undefined,
  })

  return <div className="p-4 space-y-4">
    <div className="flex items-center gap-2 text-sm text-gray-500"><Users className="w-4 h-4" /><span>发送给：{member ? currentEnsemble?.members.find(value => value.id === member)?.name : SECTIONS.find(section => section.id === selectedSection)?.name || '全体成员'}</span></div>
    <label className="block text-sm font-medium text-gray-700">个人提示
      <select aria-label="提示目标乐手" className="input w-full mt-1" value={member} onChange={event => setMember(event.target.value)}>
        <option value="">{selectedSection ? '当前声部全体' : '全体乐手'}</option>
        {currentEnsemble?.members.filter(value => value.role === 'PLAYER' && (!selectedSection || value.section === selectedSection)).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select>
    </label>
    <div className="space-y-2"><label className="text-sm font-medium text-gray-700" htmlFor="cue-bpm">节拍器速度 (BPM)</label><div className="flex items-center gap-2"><input id="cue-bpm" type="range" min="30" max="240" value={bpm} onChange={event => setBpm(Number(event.target.value))} className="flex-1" /><input aria-label="提示BPM数值" type="number" min="30" max="240" value={bpm} onChange={event => setBpm(Math.max(30, Math.min(240, Number(event.target.value) || 120)))} className="w-16 border rounded p-1 text-sm" /></div></div>
    {(tracks.length > 0 || currentScore?.audioUrl) && <label className="block text-sm">示范音频来源<select aria-label="示范音频来源" className="input w-full mt-1" value={reference} onChange={event => setReference(event.target.value)}><option value="default">乐谱默认音频</option>{tracks.map(track => <option key={track.id} value={track.id}>{track.label}</option>)}</select></label>}
    <div className="space-y-2"><label className="text-sm font-medium text-gray-700">发送提示</label><div className="grid grid-cols-2 gap-2">
      {([{ type: 'COUNT_IN', label: '预备拍', icon: Timer }, { type: 'METRONOME', label: '节拍器', icon: Volume2 }, { type: 'DEMO_AUDIO', label: '示范音频', icon: Music }, { type: 'CLICK', label: '开始', icon: Play }] as const).map(({ type, label, icon: Icon }) => <button key={type} onClick={() => send(type)} disabled={!isConnected || (type === 'DEMO_AUDIO' && !audioUrl)} className="flex items-center gap-2 p-3 rounded-lg bg-primary-50 hover:bg-primary-100 text-primary-700 disabled:opacity-50"><Icon className="w-4 h-4" /><span className="text-sm">{label}</span></button>)}
    </div></div>
    <button onClick={() => { socket?.emit('audio-control', { action: 'STOP_CUE', targetMemberId: member || undefined, targetSection: member ? undefined : selectedSection || undefined }); audioEngine.stopCue() }} disabled={!isConnected} className="w-full text-xs border rounded-lg px-3 py-2 flex items-center justify-center gap-2 disabled:opacity-50"><Square className="w-3 h-3" />停止目标提示音</button>
    <label className="text-xs flex items-center gap-2">目标讲话音量<input aria-label="目标讲话音量" type="range" min="0" max="1" step="0.05" value={receiverVolume} onChange={event => {
      const volume = Number(event.target.value)
      setReceiverVolume(volume)
      socket?.emit('audio-control', { action: 'SET_VOLUME', channel: 'live', volume, targetMemberId: member || undefined, targetSection: member ? undefined : selectedSection || undefined })
    }} className="flex-1 min-w-0" /><span>{Math.round(receiverVolume * 100)}%</span></label>
    <div className="flex items-center justify-between text-xs">
      <button onClick={() => void enablePreview()} className="text-primary-600">{preview ? '本机声音已启用' : '启用本机试听 / 录音声音'}</button>
      <button aria-label="停止本机试听" onClick={() => audioEngine.stopCue()} className="flex items-center gap-1"><Square className="w-3 h-3" />停止本机</button>
    </div>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <SectionTracks editable />
    <CueHistory />
  </div>
}
