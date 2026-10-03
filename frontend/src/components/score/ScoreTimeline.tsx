import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useSocketStore } from '../../stores/socketStore'
import { useScoreSession } from '../../score/scoreSession'
import { regularTimeline } from '../../score/timeline'
import { apiFetch } from '../../utils/api'
import { SECTIONS } from '../../types'
import type { Score, RehearsalPosition } from '../../types'

export default function ScoreTimeline({ score }: { score: Score }) {
  const { currentUser, currentMeasure, setCurrentMeasure, isRehearsing } = useAppStore()
  const { socket, isConnected } = useSocketStore()
  const { timelines, position, setTimeline, setPosition } = useScoreSession()
  const conductor = currentUser?.role === 'CONDUCTOR'
  const [bpm, setBpm] = useState(120)
  const [beats, setBeats] = useState(4)
  const [beatType, setBeatType] = useState(4)
  const [count, setCount] = useState(16)
  const [running, setRunning] = useState(false)
  const [entrySection, setEntrySection] = useState('violin1')
  const [entryMeasure, setEntryMeasure] = useState(1)
  const [entries, setEntries] = useState<Record<string, number>>({})
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [timingStart, setTimingStart] = useState('0')
  const [timingEnd, setTimingEnd] = useState('2')
  const anchor = useRef({ time: 0, elapsed: 0 })
  const wasRehearsing = useRef(isRehearsing)
  const timeline = timelines[score.id] || []
  const index = Math.max(0, timeline.findIndex(item => item.number === currentMeasure))
  const selected = timeline[index]

  useEffect(() => {
    setRunning(false); setEntries({}); setMessage('')
    if (score.fileType === 'pdf') {
      const saved = score.measures || []
      setCount(saved.length || 16)
      setTimeline(score.id, saved.length ? saved.map(item => ({ number: item.number, startTime: item.startTime ?? 0, endTime: item.endTime ?? 0, bpm: 120, beats: 4, beatType: 4, soundingParts: [] })) : regularTimeline(16, 120, 4))
    }
  }, [score.id, score.fileType, setTimeline])

  useEffect(() => {
    if (selected) { setTimingStart(String(+selected.startTime.toFixed(3))); setTimingEnd(String(+selected.endTime.toFixed(3))) }
  }, [selected?.number, selected?.startTime, selected?.endTime])

  useEffect(() => {
    if (score.fileType === 'musicxml' && timeline.length) {
      setBpm(timeline[0].bpm); setBeats(timeline[0].beats); setBeatType(timeline[0].beatType)
    }
  }, [score.id, timeline.length])

  const emit = (measure: number, beat: number, isRunning: boolean) => {
    const active = timeline.find(item => item.number === measure)
    const data: RehearsalPosition = { scoreId: score.id, measure, beat, running: isRunning, bpm: active?.bpm || bpm, beatsPerMeasure: active?.beats || beats, startedAt: anchor.current.time, entryMeasures: entries }
    setCurrentMeasure(measure); setPosition(data)
    if (conductor) socket?.emit('current-position', data)
  }

  useEffect(() => {
    if (!running || !conductor || !timeline.length) return
    let previous = ''
    const timer = window.setInterval(() => {
      const elapsed = anchor.current.elapsed + (Date.now() - anchor.current.time) / 1000
      const item = timeline.find(bar => elapsed >= bar.startTime && elapsed < bar.endTime)
      if (!item) { setRunning(false); emit(timeline[timeline.length - 1].number, 1, false); return }
      const beatDuration = 60 / item.bpm * 4 / item.beatType
      const beat = Math.min(item.beats, 1 + Math.floor((elapsed - item.startTime) / beatDuration))
      const key = `${item.number}:${beat}`
      if (previous !== key) { previous = key; emit(item.number, beat, true) }
    }, 40)
    return () => clearInterval(timer)
  }, [running, conductor, timeline, score.id, entries, socket])

  useEffect(() => {
    if (!isConnected || (wasRehearsing.current && !isRehearsing)) {
      setRunning(false)
      if (conductor && isConnected && wasRehearsing.current) emit(currentMeasure, 1, false)
    }
    wasRehearsing.current = isRehearsing
  }, [isConnected, isRehearsing, conductor])

  const saveTiming = async (items = timeline) => {
    if (!currentUser) return
    setSaving(true); setMessage('')
    try {
      const response = await apiFetch(`/api/scores/${score.id}/measures`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: currentUser.id, measures: items.map(({ number, startTime, endTime }) => ({ number, startTime, endTime })) }) })
      if (!response.ok) throw new Error('保存小节时间失败')
      const measures = await response.json()
      const current = useAppStore.getState().currentScore
      if (current?.id === score.id) useAppStore.getState().setCurrentScore({ ...current, measures })
      socket?.emit('score-select', { scoreId: score.id })
      setMessage('小节时间已保存并同步')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') }
    finally { setSaving(false) }
  }

  const nextEntry = position?.scoreId === score.id ? position.entryMeasures?.[currentUser?.section || ''] : undefined
  const remaining = nextEntry ? Math.max(0, nextEntry - currentMeasure) : undefined

  return <section className="border-b p-3 space-y-3 text-sm" aria-label="小节与排练进度">
    <div className="flex justify-between font-medium"><span>第 {currentMeasure} 小节 · 第 {position?.scoreId === score.id ? position.beat || 1 : 1} 拍</span><span className="text-gray-500">{timeline.length} 小节</span></div>
    <progress aria-label="排练进度" className="w-full h-2 accent-primary-600" max={Math.max(1, timeline.length)} value={Math.min(index + 1, timeline.length)} />
    {!conductor && <p role="status" className="bg-blue-50 text-blue-800 p-2 rounded">{remaining === undefined ? '跟随指挥的小节与进拍提示' : remaining > 0 ? `还有 ${remaining} 小节进入 · 第 ${nextEntry} 小节` : currentMeasure === nextEntry ? '现在进入' : `已进入 · 第 ${nextEntry} 小节`}</p>}
    {conductor && <>
      <div className="flex gap-2 items-center"><label>小节 <input aria-label="当前小节" className="border rounded w-16 p-1" type="number" min={1} value={currentMeasure} onChange={e => { const n = Number(e.target.value); if (n > 0) { setRunning(false); emit(n, 1, false) } }} /></label><button className="btn-secondary text-xs px-2 py-1" disabled={!timeline.length || !isConnected} onClick={() => { if (running) { setRunning(false); emit(currentMeasure, 1, false) } else { anchor.current = { time: Date.now(), elapsed: selected?.startTime || 0 }; setRunning(true); emit(currentMeasure, 1, true) } }}>{running ? '暂停跟拍' : '开始跟拍'}</button></div>
      {score.fileType === 'pdf' && <details><summary className="cursor-pointer text-gray-600">PDF 拍号与小节时间</summary><div className="grid grid-cols-2 gap-2 mt-2">
        <label>BPM <input aria-label="时间轴BPM" type="number" min={20} max={300} className="border w-16 p-1" value={bpm} onChange={e => setBpm(Math.max(20, Math.min(300, Number(e.target.value))))} /></label>
        <label>小节数 <input aria-label="小节总数" type="number" min={1} max={1000} className="border w-16 p-1" value={count} onChange={e => setCount(Math.max(1, Math.min(1000, Number(e.target.value))))} /></label>
        <label>拍号 <select aria-label="时间轴拍数" className="border" value={beats} onChange={e => setBeats(Number(e.target.value))}>{[2,3,4,5,6,7,9,12].map(n => <option key={n}>{n}</option>)}</select> / <select aria-label="时间轴拍值" className="border" value={beatType} onChange={e => setBeatType(Number(e.target.value))}>{[2,4,8,16].map(n => <option key={n}>{n}</option>)}</select></label>
        <button className="btn-secondary text-xs p-1" disabled={running} onClick={() => setTimeline(score.id, regularTimeline(count, bpm, beats, beatType))}>生成时间轴</button>
      </div><p className="text-xs text-gray-500 mt-2">按 BPM 估算后，可用参考音频校准每小节起止时间。</p></details>}
      <details><summary className="cursor-pointer text-gray-600">校准与保存时间</summary><div className="flex gap-2 mt-2"><label>起始秒<input aria-label="小节起始秒" className="border w-20 p-1 block" type="number" min={0} step="0.01" value={timingStart} onChange={e => setTimingStart(e.target.value)} /></label><label>结束秒<input aria-label="小节结束秒" className="border w-20 p-1 block" type="number" min={0} step="0.01" value={timingEnd} onChange={e => setTimingEnd(e.target.value)} /></label></div><button className="btn-secondary text-xs p-1 mt-2" disabled={saving || !selected || Number(timingEnd) <= Number(timingStart) || Number(timingStart) < 0} onClick={() => { const startTime = Number(timingStart), endTime = Number(timingEnd); const updated = timeline.map(item => item.number === currentMeasure ? { ...item, startTime, endTime } : item); setTimeline(score.id, updated); void saveTiming(updated) }}>保存当前小节校准</button><button className="btn-secondary text-xs p-1 mt-2 ml-2" disabled={saving || !timeline.length} onClick={() => void saveTiming()}>保存全部</button></details>
      <details><summary className="cursor-pointer text-gray-600">声部进拍提示</summary><div className="flex gap-2 mt-2"><select aria-label="进拍声部" className="border rounded w-32" value={entrySection} onChange={e => setEntrySection(e.target.value)}>{SECTIONS.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select><input aria-label="进入小节" type="number" min={1} className="border rounded w-16 p-1" value={entryMeasure} onChange={e => setEntryMeasure(Math.max(1, Number(e.target.value)))} /></div><button className="btn-secondary text-xs p-1 mt-2" disabled={!isConnected} onClick={() => { const updated = { ...entries, [entrySection]: entryMeasure }; setEntries(updated); const data = { scoreId: score.id, measure: currentMeasure, beat: 1, bpm, beatsPerMeasure: beats, running, entryMeasures: updated }; setPosition(data); socket?.emit('current-position', data) }}>同步进拍设置</button></details>
    </>}
    {message && <p role="status" className="text-xs text-gray-600">{message}</p>}
    {score.fileType === 'musicxml' && <p className="text-xs text-gray-500">小节与拍号来自 MusicXML；反复段可选择小节重新跟拍。</p>}
  </section>
}
