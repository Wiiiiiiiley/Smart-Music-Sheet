import { useEffect, useRef, useState } from 'react'
import { Music, Play, Square, Upload, Trash2 } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { SECTIONS, type Score } from '../../types'
import { apiFetch, resolveAssetUrl } from '../../utils/api'
import { audioEngine } from '../../audio/audioEngine'
import { useSocketStore } from '../../stores/socketStore'

export interface SectionTrack { id: string; label: string; section?: string; audioUrl: string; volume?: number }
type TrackScore = Score & { audioTracks?: SectionTrack[] }

export default function SectionTracks({ editable = false }: { editable?: boolean }) {
  const { currentScore, currentUser, sectionVolumes, setSectionVolume, setCurrentScore } = useAppStore()
  const { socket } = useSocketStore()
  const [tracks, setTracks] = useState<SectionTrack[]>([])
  const [section, setSection] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState<string[]>([])
  const active = useRef(new Map<string, { audio: HTMLAudioElement; disconnect: () => void }>())
  const fileInput = useRef<HTMLInputElement>(null)

  const stop = (id?: string) => {
    for (const [key, player] of active.current) if (!id || key === id) { player.audio.pause(); player.disconnect(); active.current.delete(key) }
    setPlaying([...active.current.keys()])
  }

  useEffect(() => {
    stop()
    setError('')
    setTracks((currentScore as TrackScore | null)?.audioTracks || [])
    if (!currentScore) return
    const controller = new AbortController()
    void apiFetch(`/api/scores/${currentScore.id}/tracks`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('读取声部音轨失败')
      const values = await response.json() as SectionTrack[]
      setTracks(values)
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '音轨加载失败') })
    return () => { controller.abort(); stop() }
  }, [currentScore?.id])

  useEffect(() => {
    if (!socket) return
    const changed = (data: { scoreId: string; tracks: SectionTrack[] }) => {
      if (data.scoreId !== useAppStore.getState().currentScore?.id) return
      stop()
      setTracks(data.tracks)
    }
    socket.on('score-tracks-updated', changed)
    return () => { socket.off('score-tracks-updated', changed) }
  }, [socket])

  const save = async (values: SectionTrack[]) => {
    if (!currentScore || !currentUser) return
    const response = await apiFetch(`/api/scores/${currentScore.id}/tracks`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: currentUser.id, tracks: values }),
    })
    if (!response.ok) throw new Error('保存声部音轨失败')
    const saved = await response.json() as SectionTrack[]
    setTracks(saved)
    setCurrentScore({ ...currentScore, audioTracks: saved } as TrackScore)
  }

  const upload = async (file?: File) => {
    if (!file || !currentScore) return
    if (file.size > 50 * 1024 * 1024) { setError('音频文件不能超过 50 MB'); return }
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('audio', file)
      const response = await apiFetch('/api/upload/audio', { method: 'POST', body })
      if (!response.ok) throw new Error('音轨上传失败，请检查格式和大小')
      const result = await response.json() as { fileUrl: string }
      await save([...tracks, { id: crypto.randomUUID(), label: name.trim() || file.name.replace(/\.[^.]+$/, ''), section: section || undefined, audioUrl: result.fileUrl, volume: 1 }])
      setName('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '音轨保存失败') }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }

  const play = async (values: SectionTrack[]) => {
    setError('')
    try {
      await audioEngine.unlock()
      for (const track of values) {
        stop(track.id)
        const audio = new Audio()
        audio.crossOrigin = 'anonymous'
        audio.src = resolveAssetUrl(track.audioUrl)
        const disconnect = audioEngine.connectElement(audio, track.section ? `section:${track.section}` : 'demo')
        active.current.set(track.id, { audio, disconnect })
        audio.onended = () => stop(track.id)
        audio.onerror = () => { stop(track.id); setError(`${track.label} 加载失败`) }
        await audio.play()
      }
      setPlaying([...active.current.keys()])
    } catch (failure) { stop(); setError(failure instanceof Error ? failure.message : '请允许浏览器播放声音后重试') }
  }

  const remove = async (track: SectionTrack) => {
    setBusy(true)
    setError('')
    try { await save(tracks.filter(value => value.id !== track.id)); stop(track.id) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '删除音轨失败') }
    finally { setBusy(false) }
  }

  const ownTracks = tracks.filter(track => track.section === currentUser?.section || !track.section)
  return <div className="space-y-3 border-t pt-3" aria-label="声部参考音轨">
    <h4 className="text-sm font-semibold flex gap-2 items-center"><Music className="w-4 h-4" />声部参考音轨</h4>
    {editable && <div className="space-y-2">
      <input aria-label="参考音轨名称" placeholder="音轨名称" value={name} onChange={event => setName(event.target.value)} className="input w-full text-sm" />
      <select aria-label="参考音轨声部" className="input w-full text-sm" value={section} onChange={event => setSection(event.target.value)}>
        <option value="">全团示范</option>{SECTIONS.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select>
      <input ref={fileInput} type="file" className="hidden" accept="audio/*,.mp3,.wav,.ogg,.webm,.m4a,.mp4,.aac,.flac" onChange={event => void upload(event.target.files?.[0])} />
      <button disabled={!currentScore || busy} onClick={() => fileInput.current?.click()} className="border rounded-lg p-2 text-sm w-full flex gap-2 justify-center items-center disabled:opacity-50"><Upload className="w-4 h-4" />{busy ? '保存中…' : '上传参考音轨'}</button>
    </div>}
    {tracks.length > 0 && <div className="flex gap-2">
      <button className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700" onClick={() => void play(editable ? tracks : ownTracks)} disabled={!editable && ownTracks.length === 0}>播放{editable ? '全部音轨' : '我的声部'}</button>
      <button className="text-xs px-2 py-1 rounded bg-gray-100" onClick={() => stop()}>停止全部</button>
    </div>}
    {tracks.map(track => <div key={track.id} className="bg-gray-50 rounded p-2 space-y-2">
      <div className="flex items-center gap-2">
        <button aria-label={`${playing.includes(track.id) ? '停止' : '播放'}${track.label}`} onClick={() => playing.includes(track.id) ? stop(track.id) : void play([track])} className="p-1 text-indigo-600">{playing.includes(track.id) ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
        <span className="text-xs flex-1 break-all">{track.label}<span className="block text-gray-400">{SECTIONS.find(value => value.id === track.section)?.name || '全团示范'}</span></span>
        {editable && <button aria-label={`删除${track.label}`} disabled={busy} onClick={() => void remove(track)}><Trash2 className="w-3 h-3 text-gray-500" /></button>}
      </div>
      {track.section && <label className="flex gap-2 items-center text-xs">声部音量<input aria-label={`${track.label}声部音量`} className="flex-1 min-w-0" type="range" min="0" max="1" step="0.05" value={sectionVolumes[`section:${track.section}`] ?? 1} onChange={event => setSectionVolume(`section:${track.section}`, Number(event.target.value))} /><span>{Math.round((sectionVolumes[`section:${track.section}`] ?? 1) * 100)}%</span></label>}
    </div>)}
    {!tracks.length && <p className="text-xs text-gray-500">{editable ? '可为不同声部添加独立参考录音。' : '指挥尚未添加声部音轨。'}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>
}
