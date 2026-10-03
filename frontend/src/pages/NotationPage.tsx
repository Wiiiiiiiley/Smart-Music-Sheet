import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileUp, Music2, Pause, Play, Plus, Printer, Redo2, Save, Trash2, Undo2, Volume2, VolumeX } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { apiFetch, assetUrl } from '../utils/api'
import { addMeasure, cloneScore, createScore, deleteEvent, DURATIONS, eventTicks, exportMidi, exportMusicXml, INSTRUMENTS, insertEvent, makePart, measureTicks, midiPitch, partEvents, pitchAtCursor, pitchMidi, PPQ, readNotationFile, removeMeasure, tiedNext, updateEvent, validateScore } from '../notation/model'
import type { Duration, EditCursor, NotationEvent, NotationPart, NotationScore, Step } from '../notation/model'
import { NotationPlayback } from '../notation/playback'
import { renderNotation } from '../notation/render'
import '../notation/notation.css'

type History = { past: NotationScore[]; score: NotationScore; future: NotationScore[] }
const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const KEY_LABELS = ['C♭ / a♭', 'G♭ / e♭', 'D♭ / b♭', 'A♭ / f', 'E♭ / c', 'B♭ / g', 'F / d', 'C / a', 'G / e', 'D / b', 'A / f♯', 'E / c♯', 'B / g♯', 'F♯ / d♯', 'C♯ / a♯']
const pitchLabel = (pitch: NotationEvent['pitches'][number]) => `${pitch.step}${pitch.alter === -2 ? '𝄫' : pitch.alter === -1 ? '♭' : pitch.alter === 2 ? '𝄪' : pitch.alter === 1 ? '♯' : ''}${pitch.octave}`
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'
const safeFilename = (title: string) => (title.trim() || 'EduTempo总谱').replace(/[\\/:*?"<>|]/g, '-')

function initialDraft(key: string): NotationScore {
  try { const draft = localStorage.getItem(key); if (draft) { const score = JSON.parse(draft) as NotationScore; validateScore(score); return score } } catch { /* corrupted drafts do not prevent opening the editor */ }
  return createScore()
}
function download(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function NotationPage() {
  const { scoreId } = useParams<{ scoreId: string }>()
  const navigate = useNavigate()
  const { currentEnsemble, currentUser, setCurrentEnsemble, setCurrentScore } = useAppStore()
  const draftKey = `edutempo-notation-draft:${currentEnsemble?.id || 'local'}`
  const [history, setHistory] = useState<History>(() => ({ past: [], score: initialDraft(draftKey), future: [] }))
  const score = history.score
  const [cursor, setCursor] = useState<EditCursor>(() => ({ partId: score.parts[0].id, measure: 0, voice: 1, tick: 0 }))
  const [selection, setSelection] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState(false)
  const [duration, setDuration] = useState<Duration>(4)
  const [dots, setDots] = useState(0)
  const [triplet, setTriplet] = useState(false)
  const [octave, setOctave] = useState(4)
  const [accidental, setAccidental] = useState<number | null>(null)
  const [newInstrument, setNewInstrument] = useState(4)
  const [zoom, setZoom] = useState(0.8)
  const [viewPartId, setViewPartId] = useState('')
  const [renderSize, setRenderSize] = useState({ width: 1133, height: 1200 })
  const [message, setMessage] = useState('草稿会自动保存在此浏览器')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playbackMeasure, setPlaybackMeasure] = useState(-1)
  const [help, setHelp] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const importedIdRef = useRef<string | null>(null)
  const playbackRef = useRef<NotationPlayback | null>(null)
  if (!playbackRef.current) playbackRef.current = new NotationPlayback()
  const selectedEntry = partEvents(score, cursor.partId).find(({ event }) => event.id === selection)
  const selectedEvent = selectedEntry?.event
  const activePart = score.parts.find(part => part.id === cursor.partId) || score.parts[0]

  const commit = useCallback((next: NotationScore, stopPlayback = true) => {
    validateScore(next)
    if (stopPlayback) playbackRef.current?.stop()
    setHistory(previous => ({ past: [...previous.past.slice(-99), previous.score], score: next, future: [] }))
    setError('')
  }, [])
  const replaceScore = useCallback((next: NotationScore) => {
    validateScore(next)
    playbackRef.current?.stop()
    setHistory(previous => ({ past: [...previous.past.slice(-99), previous.score], score: next, future: [] }))
    setCursor({ partId: next.parts[0].id, measure: 0, voice: 1, tick: 0 })
    setSelection(null); setViewPartId(''); setError('')
  }, [])
  const attempt = (action: () => void) => { try { action() } catch (error) { setError(errorMessage(error)) } }
  const undo = useCallback(() => {
    playbackRef.current?.stop()
    setHistory(previous => previous.past.length ? { past: previous.past.slice(0, -1), score: previous.past[previous.past.length - 1], future: [previous.score, ...previous.future] } : previous)
    setSelection(null)
  }, [])
  const redo = useCallback(() => {
    playbackRef.current?.stop()
    setHistory(previous => previous.future.length ? { past: [...previous.past, previous.score], score: previous.future[0], future: previous.future.slice(1) } : previous)
    setSelection(null)
  }, [])

  useEffect(() => {
    if (!score.parts.some(part => part.id === cursor.partId) || cursor.measure >= score.parts[0].measures.length) {
      setCursor(previous => ({ ...previous, partId: score.parts.find(part => part.id === previous.partId)?.id || score.parts[0].id, measure: Math.min(previous.measure, score.parts[0].measures.length - 1), tick: Math.min(previous.tick, measureTicks(score) - 1) }))
    }
    if (viewPartId && !score.parts.some(part => part.id === viewPartId)) setViewPartId('')
  }, [score, cursor.partId, cursor.measure, viewPartId])

  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify(score)); setMessage('草稿已自动保存到此浏览器') } catch { setMessage('浏览器存储已满，请导出 MusicXML 保存草稿') } }, 400)
    return () => clearTimeout(timer)
  }, [score, draftKey])
  useEffect(() => () => playbackRef.current?.dispose(), [])

  useEffect(() => {
    if (!scoreId || importedIdRef.current === scoreId) return
    let cancelled = false
    const controller = new AbortController()
    setBusy(true)
    void (async () => {
      try {
        const response = await apiFetch(`/api/scores/${scoreId}${currentUser ? `?memberId=${encodeURIComponent(currentUser.id)}` : ''}`, { signal: controller.signal })
        if (!response.ok) throw new Error('无法读取要编辑的乐谱')
        const existing = await response.json()
        if (existing.fileType !== 'musicxml') throw new Error('PDF 可显示与批注；打谱编辑请导入 MusicXML 或 MXL 文件')
        const fileResponse = await fetch(assetUrl(existing.fileUrl), { signal: controller.signal })
        if (!fileResponse.ok) throw new Error('MusicXML 文件读取失败')
        const file = new File([await fileResponse.arrayBuffer()], 'score.musicxml')
        const imported = await readNotationFile(file)
        if (!cancelled) { importedIdRef.current = scoreId; replaceScore(imported); setMessage('已导入曲谱；保存到乐团将创建新的版本') }
      } catch (error) { if (!cancelled) setError(errorMessage(error)) }
      finally { if (!cancelled) setBusy(false) }
    })()
    return () => { cancelled = true; controller.abort() }
  }, [scoreId, currentUser?.id, replaceScore])

  useEffect(() => {
    if (!hostRef.current) return
    try { setRenderSize(renderNotation(hostRef.current, score, selection, cursor, playbackMeasure, viewPartId || undefined)) }
    catch (error) { setError(`谱面绘制失败：${errorMessage(error)}。可撤销上一步或导出 MusicXML。`) }
  }, [score, selection, cursor, playbackMeasure, viewPartId])

  const updateSelected = (patch: Partial<NotationEvent>) => {
    if (!selectedEvent) return
    attempt(() => commit(updateEvent(score, cursor.partId, selectedEvent.id, patch)))
  }
  const setNoteDuration = (value: Duration) => { setDuration(value); if (selectedEvent && !inputMode) updateSelected({ duration: value }) }
  const setNoteDots = (value: number) => { setDots(value); if (selectedEvent && !inputMode) updateSelected({ dots: value }) }
  const setNoteTriplet = (value: boolean) => { setTriplet(value); if (selectedEvent && !inputMode) updateSelected({ triplet: value }) }
  const inputPitch = (step: Step | null, chord = false) => attempt(() => {
    const pitch = step && pitchAtCursor(score, cursor, step, octave, accidental)
    if (chord && pitch) {
      const target = selectedEvent || partEvents(score, cursor.partId).filter(({ event, measure }) => event.voice === cursor.voice && measure * measureTicks(score) + event.tick < cursor.measure * measureTicks(score) + cursor.tick).slice(-1)[0]?.event
      if (!target?.pitches.length) throw new Error('先输入或选择一个音符，再按 Shift + A–G 添加和弦音')
      if (target.pitches.some(existing => pitchMidi(existing) === pitchMidi(pitch))) return
      commit(updateEvent(score, cursor.partId, target.id, { pitches: [...target.pitches, pitch].sort((a, b) => pitchMidi(a) - pitchMidi(b)) }))
      setSelection(target.id)
      return
    }
    if (!inputMode && selectedEvent) {
      commit(updateEvent(score, cursor.partId, selectedEvent.id, { pitches: pitch ? [pitch] : [] }))
      return
    }
    const result = insertEvent(score, cursor, { duration, dots, triplet, pitches: pitch ? [pitch] : [] })
    commit(result.score); setCursor(result.cursor); setSelection(result.eventId)
  })
  const tie = () => attempt(() => {
    if (!selectedEvent?.pitches.length) throw new Error('先选择需要延音的音符')
    if (selectedEvent.tieNext) { updateSelected({ tieNext: false }); return }
    const position: EditCursor = { partId: cursor.partId, voice: selectedEvent.voice, measure: selectedEntry!.measure, tick: selectedEvent.tick + eventTicks(selectedEvent) }
    if (position.tick >= measureTicks(score)) { position.measure++; position.tick = 0 }
    let next = cloneScore(score)
    if (position.measure >= next.parts[0].measures.length) next = addMeasure(next)
    const existing = next.parts.find(part => part.id === position.partId)!.measures[position.measure].events.find(event => event.tick === position.tick && event.voice === position.voice)
    if (existing && (existing.pitches.length !== selectedEvent.pitches.length || !existing.pitches.every(pitch => selectedEvent.pitches.some(other => pitchMidi(other) === pitchMidi(pitch))))) throw new Error('延音线两端需要相同的音高；先把下一个音符改为相同音高')
    if (!existing) next = insertEvent(next, position, { duration: selectedEvent.duration, dots: selectedEvent.dots, triplet: selectedEvent.triplet, pitches: selectedEvent.pitches }).score
    next = updateEvent(next, cursor.partId, selectedEvent.id, { tieNext: true })
    if (!tiedNext(next, cursor.partId, selectedEvent.id)) throw new Error('这个时值无法在下一拍延续，请选择较短的延音音符')
    commit(next)
  })
  const movePitch = (direction: number, wholeOctave = false, semitone = false) => {
    if (!selectedEvent?.pitches.length) return
    updateSelected({ pitches: selectedEvent.pitches.map(pitch => {
      if (wholeOctave) return { ...pitch, octave: pitch.octave + direction }
      if (semitone) return midiPitch(pitchMidi(pitch) + direction)
      const position = STEPS.indexOf(pitch.step) + direction
      return { ...pitch, step: STEPS[(position + 7) % 7], octave: pitch.octave + (position < 0 ? -1 : position >= 7 ? 1 : 0) }
    }) })
  }
  const moveSelection = (direction: number) => {
    const entries = partEvents(score, cursor.partId).filter(entry => entry.event.voice === cursor.voice)
    const index = entries.findIndex(entry => entry.event.id === selection)
    const entry = entries[Math.min(entries.length - 1, Math.max(0, index < 0 ? 0 : index + direction))]
    if (entry) { setSelection(entry.event.id); setCursor(previous => ({ ...previous, measure: entry.measure, tick: entry.event.tick, voice: entry.event.voice })) }
  }
  const deleteSelected = () => { if (selectedEvent) { commit(deleteEvent(score, selectedEvent.id)); setSelection(null); setCursor(previous => ({ ...previous, measure: selectedEntry!.measure, tick: selectedEvent.tick })) } }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (command && event.altKey && /^[1-4]$/.test(event.key)) { event.preventDefault(); setCursor(previous => ({ ...previous, voice: Number(event.key) })); setSelection(null); return }
      if (command && !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      if (event.key === 'Escape') { setInputMode(false); setSelection(null); return }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setInputMode(value => !value); return }
      const chosen = DURATIONS.find(item => item.shortcut === event.key)
      if (chosen) { event.preventDefault(); setNoteDuration(chosen.value); return }
      if (event.key === '.') { event.preventDefault(); setNoteDots((dots + 1) % 3); return }
      if (event.key === '0') { event.preventDefault(); inputPitch(null); return }
      if (/^[a-g]$/i.test(event.key)) { event.preventDefault(); inputPitch(event.key.toUpperCase() as Step, event.shiftKey); return }
      if (event.key.toLowerCase() === 't') { event.preventDefault(); tie(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); moveSelection(event.key === 'ArrowLeft' ? -1 : 1); return }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); movePitch(event.key === 'ArrowUp' ? 1 : -1, command, event.altKey); return }
      if (event.key === ' ') { event.preventDefault(); void togglePlayback() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const handleScoreClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest('[data-event-id],[data-measure]') : null
    if (!target) return
    const eventId = target.getAttribute('data-event-id')
    const partId = target.getAttribute('data-part-id') || cursor.partId
    if (eventId && !eventId.startsWith('rest-')) {
      const entry = partEvents(score, partId).find(entry => entry.event.id === eventId)
      if (!entry) return
      setCursor({ partId, measure: entry.measure, voice: entry.event.voice, tick: entry.event.tick })
      setSelection(eventId); setDuration(entry.event.duration); setDots(entry.event.dots); setTriplet(entry.event.triplet)
      if (entry.event.pitches[0]) setOctave(entry.event.pitches[0].octave)
      return
    }
    const area = target.hasAttribute('data-measure') ? target : null
    if (!area) return
    const bounds = hostRef.current?.getBoundingClientRect()
    if (!bounds) return
    const x = (event.clientX - bounds.left) / zoom
    const start = Number(area.getAttribute('data-start-x')), end = Number(area.getAttribute('data-end-x'))
    const step = eventTicks({ duration, dots, triplet })
    const tick = Math.min(measureTicks(score) - step, Math.max(0, Math.floor((x - start) / (end - start) * measureTicks(score) / step) * step))
    setCursor({ partId, measure: Number(area.getAttribute('data-measure')), voice: cursor.voice, tick: Math.max(0, tick) }); setSelection(null)
    const part = score.parts.find(part => part.id === partId)
    if (part?.clef === 'bass') setOctave(3)
    else setOctave(4)
  }

  const changePart = (partId: string, patch: Partial<NotationPart>, stopPlayback = true) => {
    const next = cloneScore(score)
    const part = next.parts.find(part => part.id === partId)
    if (part) { Object.assign(part, patch); commit(next, stopPlayback); playbackRef.current?.setPartVolume(part.id, part.volume, part.muted) }
  }
  const togglePlayback = async () => {
    if (playing) { playbackRef.current?.stop(); return }
    try { await playbackRef.current?.play(score, cursor.measure, (measure, stopped) => { setPlaybackMeasure(measure); setPlaying(!stopped) }); setPlaying(true) }
    catch (error) { setError(`无法播放：${errorMessage(error)}`) }
  }
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    try { replaceScore(await readNotationFile(file)); setMessage(`已导入 ${file.name}，原草稿可用撤销恢复`) }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const saveToEnsemble = async () => {
    if (!currentEnsemble || !currentUser) { setError('先创建或加入乐团，再将总谱保存到乐团；当前可以直接导出文件'); return }
    setBusy(true); setError('')
    try {
      const xml = exportMusicXml(score)
      const form = new FormData()
      form.append('score', new File([xml], `${safeFilename(score.title)}.musicxml`, { type: 'application/vnd.recordare.musicxml+xml' }))
      const upload = await apiFetch('/api/upload/score', { method: 'POST', body: form })
      if (!upload.ok) throw new Error('总谱上传失败')
      const uploadResult = await upload.json()
      if (!uploadResult.fileUrl) throw new Error('服务器没有返回乐谱文件地址')
      const response = await apiFetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: score.title.trim() || '无标题总谱', composer: score.composer || undefined, fileUrl: uploadResult.fileUrl, fileType: 'musicxml', ensembleId: currentEnsemble.id }) })
      if (!response.ok) throw new Error('乐团曲目保存失败')
      const saved = await response.json()
      const secondsPerMeasure = measureTicks(score) / PPQ * 60 / score.bpm
      const timing = await apiFetch(`/api/scores/${saved.id}/measures`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: currentUser.id, measures: score.parts[0].measures.map((_, index) => ({ number: index + 1, startTime: index * secondsPerMeasure, endTime: (index + 1) * secondsPerMeasure })) }) })
      const measures = timing.ok ? await timing.json() : []
      setCurrentScore({ ...saved, marks: saved.marks || [], measures: Array.isArray(measures) ? measures : saved.measures || [] })
      setCurrentEnsemble({ ...currentEnsemble, scores: [saved, ...currentEnsemble.scores.filter(existing => existing.id !== saved.id)] })
      navigate(`/conductor/score/${saved.id}`)
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const printScore = () => {
    const svg = hostRef.current?.querySelector('svg')
    if (!svg) return
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-10000px;width:1100px;height:1000px;border:0'
    document.body.appendChild(frame)
    const printDocument = frame.contentDocument
    if (!printDocument) { frame.remove(); setError('浏览器无法创建打印预览'); return }
    printDocument.open(); printDocument.write('<!doctype html><html><head><meta charset="utf-8"><title>EduTempo 总谱</title><style>@page{size:A4 portrait;margin:8mm}body{margin:0}svg{width:100%;height:auto}rect[data-event-id],rect[data-measure]{display:none}line[stroke="#2563eb"]{display:none}</style></head><body></body></html>'); printDocument.close()
    const printHost = printDocument.createElement('div')
    printDocument.body.appendChild(printHost)
    // Render without editor selection and split each system so printed pages never cut through a staff.
    const parts = viewPartId ? score.parts.filter(part => part.id === viewPartId) : score.parts
    const systemHeight = parts.length * 125 + 64
    const systems = Math.ceil(score.parts[0].measures.length / 2)
    for (let index = 0; index < systems; index++) {
      const copy = svg.cloneNode(true) as SVGSVGElement
      const y = index === 0 ? 0 : 110 + index * systemHeight
      const height = systemHeight + (index === 0 ? 110 : 0)
      copy.setAttribute('viewBox', `0 ${y} ${renderSize.width} ${height}`)
      copy.setAttribute('height', String(height)); copy.style.breakInside = 'avoid'; copy.style.display = 'block'
      copy.querySelectorAll('rect[fill="#eff6ff"],rect[fill="#dcfce7"]').forEach(rect => rect.setAttribute('fill', '#fff'))
      printHost.appendChild(copy)
    }
    frame.contentWindow?.focus()
    setTimeout(() => { frame.contentWindow?.print(); setTimeout(() => frame.remove(), 60_000) }, 100)
  }

  return (
    <div className="notation-editor h-full overflow-y-auto flex flex-col bg-slate-100">
      <header className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><button type="button" onClick={() => navigate('/conductor')} className="p-2 rounded hover:bg-slate-800" aria-label="返回指挥台"><ArrowLeft className="w-5 h-5" /></button><Music2 className="w-6 h-6 text-blue-300" /><div><h1 className="font-semibold">乐团打谱工作台</h1><p className="text-xs text-slate-400">多乐器总谱 · 4 个独立声音 · MusicXML</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { replaceScore(createScore()); setMessage('已创建新的乐团总谱；撤销可恢复之前的草稿') }} disabled={busy} className="notation-header-button"><Plus size={16} />新建</button>
          <label className="notation-header-button cursor-pointer"><FileUp size={16} />导入<input type="file" accept=".musicxml,.xml,.mxl" aria-label="导入 MusicXML 或 MXL" onChange={importFile} disabled={busy} className="sr-only" /></label>
          <button type="button" onClick={() => attempt(() => download(exportMusicXml(score), 'application/vnd.recordare.musicxml+xml', `${safeFilename(score.title)}.musicxml`))} className="notation-header-button"><Download size={16} />MusicXML</button>
          <button type="button" onClick={() => attempt(() => download(exportMidi(score).buffer as ArrayBuffer, 'audio/midi', `${safeFilename(score.title)}.mid`))} className="notation-header-button"><Download size={16} />MIDI</button>
          <button type="button" onClick={printScore} className="notation-header-button"><Printer size={16} />打印 / PDF</button>
          <button type="button" onClick={() => void saveToEnsemble()} disabled={busy || !currentEnsemble || currentUser?.role !== 'CONDUCTOR'} className="notation-header-button bg-blue-600 hover:bg-blue-500"><Save size={16} />{busy ? '处理中…' : scoreId ? '保存新版本到乐团' : '保存到乐团'}</button>
        </div>
      </header>
      {error && <div role="alert" className="px-4 py-2 bg-red-50 text-red-800 border-b border-red-200 text-sm">{error}</div>}
      {busy && <div role="status" className="px-4 py-2 bg-blue-50 text-blue-800 text-sm">正在读取或保存总谱…</div>}
      <div className="bg-white px-4 py-3 border-b flex flex-wrap items-end gap-3">
        <label className="notation-field flex-1 min-w-40">曲名<input aria-label="总谱曲名" value={score.title} onChange={event => commit({ ...score, title: event.target.value })} /></label>
        <label className="notation-field">作曲<input aria-label="作曲家" value={score.composer} onChange={event => commit({ ...score, composer: event.target.value })} /></label>
        <label className="notation-field">调号<select aria-label="总谱调号" value={score.fifths} onChange={event => commit({ ...score, fifths: Number(event.target.value) })}>{KEY_LABELS.map((label, index) => <option key={label} value={index - 7}>{label}</option>)}</select></label>
        <label className="notation-field">拍号<select aria-label="总谱拍号" value={`${score.beats}/${score.beatType}`} onChange={event => attempt(() => { const [beats, beatType] = event.target.value.split('/').map(Number); commit({ ...score, beats, beatType }) })}>{['2/4', '3/4', '4/4', '5/4', '6/4', '3/8', '6/8', '9/8', '12/8', '2/2', '3/2'].map(meter => <option key={meter}>{meter}</option>)}</select></label>
        <label className="notation-field">速度 ♩<input aria-label="总谱速度" type="number" min={20} max={300} value={score.bpm} onChange={event => { const bpm = Number(event.target.value); if (bpm >= 20 && bpm <= 300) commit({ ...score, bpm }) }} className="w-20" /></label>
      </div>
      <div className="notation-tools bg-white border-b px-4 py-2 flex flex-wrap gap-2 items-center">
        <button type="button" aria-label="撤销" title="撤销 Ctrl / Cmd + Z" onClick={undo} disabled={!history.past.length}><Undo2 size={18} /></button>
        <button type="button" aria-label="重做" title="重做 Ctrl / Cmd + Shift + Z" onClick={redo} disabled={!history.future.length}><Redo2 size={18} /></button>
        <span className="w-px h-6 bg-slate-200 mx-1" />
        <button type="button" aria-pressed={inputMode} onClick={() => setInputMode(value => !value)} className={inputMode ? 'active' : ''}>N 音符输入</button>
        {DURATIONS.map(item => <button type="button" key={item.value} aria-pressed={duration === item.value} onClick={() => setNoteDuration(item.value)} className={duration === item.value ? 'active' : ''} title={`${item.label}（键 ${item.shortcut}）`}>{item.label}<small>{item.shortcut}</small></button>)}
        <button type="button" onClick={() => inputPitch(null)} title="休止符（键 0）">休止 0</button>
        <button type="button" aria-pressed={dots > 0} onClick={() => setNoteDots((dots + 1) % 3)} className={dots ? 'active' : ''} title="附点（键 .）；再次点击为双附点">附点{dots === 2 ? '··' : '·'}</button>
        <button type="button" aria-pressed={triplet} onClick={() => setNoteTriplet(!triplet)} className={triplet ? 'active' : ''}>三连音 3:2</button>
        <button type="button" onClick={tie} disabled={!selectedEvent?.pitches.length} title="延音线（键 T）">延音 T</button>
        <button type="button" aria-label="删除所选音符" onClick={deleteSelected} disabled={!selectedEvent}><Trash2 size={17} /></button>
        <button type="button" onClick={() => setHelp(value => !value)} className="ml-auto">快捷键</button>
      </div>
      {help && <div className="px-4 py-3 bg-blue-50 text-blue-900 text-sm">N 切换输入；1–7 选择时值；A–G 输入音高；0 休止；Shift + A–G 添加和弦音；. 附点；T 延音；← / → 选择；↑ / ↓ 改音高；Alt + ↑ / ↓ 半音；Ctrl / Cmd + ↑ / ↓ 八度；Ctrl / Cmd + Alt + 1–4 切换声音；Delete 删除；空格播放；Ctrl / Cmd + Z 撤销。输入会覆盖当前声音中重叠的音符。</div>}
      <main className="flex-1 flex min-h-0 notation-main">
        <aside className="notation-sidebar bg-white border-r border-slate-200 w-64 shrink-0 p-3 space-y-4 overflow-y-auto">
          <div><h2 className="text-sm font-semibold text-slate-700 mb-2">乐器与混音</h2><div className="space-y-2">{score.parts.map(part => <div key={part.id} className={`rounded-lg border p-2 ${cursor.partId === part.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
            <div className="flex items-center gap-1"><button type="button" className="flex-1 text-left text-sm font-medium truncate" onClick={() => { setCursor(previous => ({ ...previous, partId: part.id })); setSelection(null); setOctave(part.clef === 'bass' ? 3 : 4) }}>{part.name}</button><button type="button" aria-label={`${part.muted ? '取消静音' : '静音'}${part.name}`} onClick={() => changePart(part.id, { muted: !part.muted }, false)} className="p-1 text-slate-500">{part.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div>
            <input aria-label={`${part.name}音量`} type="range" min={0} max={1} step={0.05} value={part.volume} onChange={event => changePart(part.id, { volume: Number(event.target.value) }, false)} className="w-full accent-blue-600" />
            {cursor.partId === part.id && <div className="flex gap-1 text-xs mt-1"><select aria-label={`${part.name}谱号`} value={part.clef} onChange={event => changePart(part.id, { clef: event.target.value as NotationPart['clef'] })} className="rounded border p-1 flex-1"><option value="treble">高音谱号</option><option value="alto">中音谱号</option><option value="bass">低音谱号</option></select><button type="button" aria-label={`移除${part.name}`} disabled={score.parts.length <= 1} onClick={() => commit({ ...score, parts: score.parts.filter(item => item.id !== part.id) })} className="text-red-600 px-1 disabled:opacity-30"><Trash2 size={14} /></button></div>}
          </div>)}</div><div className="flex gap-1 mt-2"><select aria-label="添加乐器类型" value={newInstrument} onChange={event => setNewInstrument(Number(event.target.value))} className="min-w-0 flex-1 rounded border p-1 text-xs">{INSTRUMENTS.map((instrument, index) => <option key={index} value={index}>{instrument.name}</option>)}</select><button type="button" aria-label="添加乐器声部" disabled={score.parts.length >= 32} onClick={() => attempt(() => { const part = makePart(INSTRUMENTS[newInstrument], score.parts[0].measures.length); commit({ ...score, parts: [...score.parts, part] }); setCursor(previous => ({ ...previous, partId: part.id })); setOctave(part.clef === 'bass' ? 3 : 4) })} className="px-2 py-1 rounded bg-blue-600 text-white"><Plus size={16} /></button></div></div>
          <div className="space-y-2"><h2 className="text-sm font-semibold text-slate-700">当前声音</h2><div className="grid grid-cols-4 gap-1">{[1, 2, 3, 4].map(voice => <button type="button" key={voice} aria-pressed={cursor.voice === voice} onClick={() => { setCursor(previous => ({ ...previous, voice })); setSelection(null) }} className={`py-1 rounded border ${cursor.voice === voice ? 'bg-blue-600 text-white' : 'bg-white'}`}>{voice}</button>)}</div><p className="text-xs text-slate-500">每个乐器谱表可包含 4 个独立声音。移调乐器以记谱音显示，以实音播放。</p></div>
          <div className="space-y-2"><h2 className="text-sm font-semibold text-slate-700">输入音高</h2><div className="flex gap-2"><label className="notation-field flex-1">八度<select aria-label="输入八度" value={octave} onChange={event => setOctave(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value}>{value}</option>)}</select></label><label className="notation-field flex-1">变音<select aria-label="输入变音" value={accidental === null ? 'auto' : accidental} onChange={event => { const value = event.target.value === 'auto' ? null : Number(event.target.value); setAccidental(value); if (selectedEvent && !inputMode && value !== null) updateSelected({ pitches: selectedEvent.pitches.map(pitch => ({ ...pitch, alter: value })) }) }}><option value="auto">随调号</option><option value={-2}>重降 𝄫</option><option value={-1}>降 ♭</option><option value={0}>还原 ♮</option><option value={1}>升 ♯</option><option value={2}>重升 𝄪</option></select></label></div><div className="notation-piano flex">{STEPS.map(step => <button type="button" key={step} aria-label={`输入 ${step}${octave}`} onClick={event => inputPitch(step, event.shiftKey)}>{step}<small>{octave}</small></button>)}</div></div>
          {selectedEvent && <div className="space-y-2 border-t pt-3"><h2 className="text-sm font-semibold text-slate-700">所选音符</h2><p className="text-sm">{selectedEvent.pitches.map(pitchLabel).join(' + ') || '休止符'} · 第 {selectedEntry!.measure + 1} 小节</p><div className="flex gap-1"><button type="button" onClick={() => movePitch(-1)} className="notation-small-button">降一级</button><button type="button" onClick={() => movePitch(1)} className="notation-small-button">升一级</button>{selectedEvent.pitches.length > 1 && <button type="button" onClick={() => updateSelected({ pitches: selectedEvent.pitches.slice(0, -1) })} className="notation-small-button">去掉最高音</button>}</div><label className="notation-field">力度<select aria-label="所选音符力度" value={selectedEvent.dynamic || ''} onChange={event => updateSelected({ dynamic: event.target.value || undefined })}><option value="">无标记</option>{['pp', 'p', 'mp', 'mf', 'f', 'ff'].map(value => <option key={value}>{value}</option>)}</select></label><label className="notation-field">奏法<select aria-label="所选音符奏法" value={selectedEvent.articulation || ''} onChange={event => updateSelected({ articulation: event.target.value as NotationEvent['articulation'] || undefined })}><option value="">无标记</option><option value="staccato">断奏</option><option value="accent">重音</option><option value="tenuto">保持音</option></select></label><label className="notation-field">歌词 / 音符文字<input aria-label="所选音符文字" value={selectedEvent.lyric || ''} maxLength={80} onChange={event => updateSelected({ lyric: event.target.value || undefined })} /></label></div>}
        </aside>
        <section className="flex-1 min-w-0 flex flex-col">
          <div className="bg-slate-50 border-b px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => void togglePlayback()} className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 text-white">{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? '停止播放' : '从当前小节播放'}</button>
            <label className="flex items-center gap-1">小节<select aria-label="当前小节" value={cursor.measure} onChange={event => { setCursor(previous => ({ ...previous, measure: Number(event.target.value), tick: 0 })); setSelection(null) }} className="border rounded p-1">{score.parts[0].measures.map((_, index) => <option key={index} value={index}>{index + 1}</option>)}</select></label>
            <button type="button" onClick={() => attempt(() => commit(addMeasure(score, cursor.measure)))} disabled={score.parts[0].measures.length >= 200} className="notation-small-button">＋ 小节</button>
            <button type="button" onClick={() => attempt(() => { commit(removeMeasure(score, cursor.measure)); setSelection(null) })} disabled={score.parts[0].measures.length <= 1} className="notation-small-button">删除小节</button>
            <select aria-label="总谱或分谱视图" value={viewPartId} onChange={event => setViewPartId(event.target.value)} className="border rounded p-1 ml-auto"><option value="">完整总谱</option>{score.parts.map(part => <option key={part.id} value={part.id}>{part.name}分谱</option>)}</select>
            <label className="flex items-center gap-1">缩放<select aria-label="打谱缩放" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="border rounded p-1">{[0.5, 0.65, 0.8, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label>
          </div>
          <div ref={scrollRef} className="flex-1 min-h-96 overflow-auto p-4 notation-score-scroll"><div className="mx-auto bg-white shadow-lg" style={{ width: renderSize.width * zoom, height: renderSize.height * zoom }}><div ref={hostRef} onClick={handleScoreClick} style={{ width: renderSize.width, height: renderSize.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }} /></div></div>
          <footer className="bg-white border-t px-3 py-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{activePart.name} · 第 {cursor.measure + 1} 小节 · 声音 {cursor.voice} · 第 {(cursor.tick / PPQ + 1).toFixed(2).replace(/\.00$/, '')} 拍{inputMode ? ' · 输入模式' : ' · 选择模式'}</span><span role="status">{message}</span></footer>
        </section>
      </main>
    </div>
  )
}
