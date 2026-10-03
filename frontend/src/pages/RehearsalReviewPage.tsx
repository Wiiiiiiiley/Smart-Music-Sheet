import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Square } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { apiFetch, resolveAssetUrl } from '../utils/api'
import { audioEngine } from '../audio/audioEngine'
import { cueLabels, readCue } from '../audio/cueHistory'
import type { Rehearsal, RehearsalEvent } from '../types'
import { SECTIONS } from '../types'

const names: Record<string,string> = { REHEARSAL_STARTED:'排练开始',REHEARSAL_ENDED:'排练结束',CUE_SENT:'指挥提示',MISTAKE_REPORTED:'演奏反馈',MARK_ADDED:'乐谱批注',RECORDING_STARTED:'录音开始',RECORDING_SAVED:'录音保存',POSITION_UPDATED:'小节定位' }
function eventData(event: RehearsalEvent): Record<string,unknown> { try { return JSON.parse(event.data) } catch { return {} } }

export default function RehearsalReviewPage() {
  const navigate = useNavigate()
  const { currentEnsemble, currentUser } = useAppStore()
  const [list, setList] = useState<Rehearsal[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<Rehearsal | null>(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const recording = useRef<HTMLAudioElement>(null)
  const back = currentUser?.role === 'CONDUCTOR' ? '/conductor' : `/player/${currentEnsemble?.id || ''}`

  useEffect(() => {
    if (!currentEnsemble || !currentUser) return
    let cancelled = false
    setLoading(true); setError('')
    void apiFetch(`/api/rehearsals?ensembleId=${encodeURIComponent(currentEnsemble.id)}&memberId=${encodeURIComponent(currentUser.id)}`)
      .then(async response => { if (!response.ok) throw new Error('读取排练列表失败'); return response.json() as Promise<Rehearsal[]> })
      .then(data => { if (!cancelled) { setList(data); setSelectedId(previous => data.some(item => item.id === previous) ? previous : data[0]?.id || '') } })
      .catch(failure => { if (!cancelled) setError(failure.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentEnsemble?.id, currentUser?.id, retry])

  useEffect(() => {
    if (!selectedId || !currentUser) { setDetail(null); return }
    let cancelled = false
    setLoading(true); setError(''); setDetail(null); setCurrentTime(0)
    void apiFetch(`/api/rehearsals/${selectedId}?memberId=${encodeURIComponent(currentUser.id)}`)
      .then(async response => { if (!response.ok) throw new Error('读取排练复盘失败'); return response.json() as Promise<Rehearsal> })
      .then(data => { if (!cancelled) setDetail(data) })
      .catch(failure => { if (!cancelled) setError(failure.message) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; audioEngine.stopCue() }
  }, [selectedId, currentUser?.id, retry])

  const events = detail?.events || []
  const reports = events.filter(event => event.type === 'MISTAKE_REPORTED' || event.type === 'MISTAKE_DETECTED')
  const cues = events.filter(event => event.type === 'CUE_SENT')
  const duration = detail ? Math.max(0, (Date.parse(detail.endedAt || new Date().toISOString()) - Date.parse(detail.startedAt)) / 1000) : 0
  const startEvent = events.filter(event => event.type === 'RECORDING_STARTED').slice(-1)[0]
  const started = startEvent ? eventData(startEvent).recordingStartedAt : undefined
  const recordStart = startEvent ? Date.parse(typeof started === 'string' ? started : startEvent.timestamp) : detail ? Date.parse(detail.startedAt) : 0
  const offset = (event: RehearsalEvent) => Math.max(0, (Date.parse(event.timestamp) - recordStart) / 1000)
  const viewEvents = events.filter(event => filter === 'all' || event.type === filter)

  const replay = async (event: RehearsalEvent) => {
    const cue = readCue(event)
    if (!cue) return
    setError('')
    try { await audioEngine.playCue(cue) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '回听失败') }
  }

  return <div className="h-full overflow-auto bg-gray-50">
    <header className="bg-white border-b px-4 py-3 flex items-center gap-4 sticky top-0 z-10"><button className="flex gap-2 items-center text-gray-600" onClick={() => navigate(back)}><ArrowLeft className="w-4 h-4" />返回排练</button><h1 className="font-bold">排练复盘</h1><button className="ml-auto btn-secondary text-sm" onClick={() => setRetry(value => value + 1)}>刷新记录</button></header>
    <main className="max-w-5xl mx-auto p-4 space-y-4">
      <label className="block">选择排练<select aria-label="选择排练记录" value={selectedId} className="border rounded p-2 ml-3 max-w-full" onChange={e => setSelectedId(e.target.value)}><option value="" disabled>请选择</option>{list.map(item => <option value={item.id} key={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.endedAt ? '已结束' : '进行中'}</option>)}</select></label>
      {loading && <p role="status">正在读取排练记录…</p>}
      {error && <p role="alert" className="bg-red-50 p-3 rounded text-red-700">{error}</p>}
      {!loading && !list.length && <div className="panel p-8 text-center text-gray-500">开始一次排练后，提示、演奏反馈与录音会保存在这里。</div>}
      {detail && <>
        <div className="grid grid-cols-3 gap-3">{[['排练时长',`${Math.floor(duration/60)}分${Math.floor(duration%60)}秒`],['关键提示',cues.length],['演奏反馈',reports.length]].map(([label,value]) => <div className="panel p-4" key={label}><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div>)}</div>
        <section className="panel p-4 space-y-3"><h2 className="font-semibold">排练录音</h2>{detail.recordingUrl ? <><audio aria-label="排练录音" ref={recording} key={detail.recordingUrl} controls className="w-full" src={resolveAssetUrl(detail.recordingUrl)} onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)} /><a href={resolveAssetUrl(detail.recordingUrl)} target="_blank" rel="noreferrer" className="text-sm text-blue-700 underline">打开或下载录音</a><p className="text-xs text-gray-500">当前 {Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,'0')} · 点击事件可定位录音。</p></> : <p className="text-gray-500 text-sm">这次排练尚未保存录音。</p>}</section>
        {reports.length > 0 && <section className="panel p-4"><h2 className="font-semibold mb-3">声部反馈分布</h2><div className="flex flex-wrap gap-2">{Object.entries(reports.reduce((result: Record<string,number>,event) => { const data=eventData(event); const section=typeof data.targetSection==='string'?data.targetSection:'all'; result[section]=(result[section]||0)+1; return result },{})).map(([section,value]) => <span className="bg-amber-50 text-amber-900 px-3 py-2 rounded text-sm" key={section}>{SECTIONS.find(item=>item.id===section)?.name || (section==='all'?'全体 / 个人':section)}：{value}</span>)}</div><p className="text-xs text-gray-500 mt-3">根据指挥记录汇总，供复盘使用。</p></section>}
        <section className="panel p-4"><div className="flex justify-between gap-3 mb-4"><h2 className="font-semibold">事件时间线</h2><select aria-label="复盘事件筛选" className="border rounded text-sm" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部事件</option><option value="CUE_SENT">关键提示</option><option value="MISTAKE_REPORTED">演奏反馈</option></select></div><div className="space-y-3">{viewEvents.map(event=>{const data=eventData(event);const cue=readCue(event);const seconds=offset(event);return <div className="border-l-2 border-blue-200 pl-4 py-2 flex flex-wrap gap-3 items-start" key={event.id}><button disabled={!detail.recordingUrl} className="font-mono text-xs text-blue-700 disabled:text-gray-400 p-1" title="定位录音" onClick={()=>{if(recording.current){recording.current.currentTime=Math.min(seconds,Number.isFinite(recording.current.duration)?recording.current.duration:seconds);void recording.current.play().catch(()=>setError('请点击录音播放器启用声音'))}}}>{Math.floor(seconds/60)}:{String(Math.floor(seconds%60)).padStart(2,'0')}</button><div className="flex-1 min-w-36"><p className="text-sm font-medium">{cue?cueLabels[cue.type]:names[event.type]||event.type}{data.measure||data.measureNumber?` · 第 ${data.measure||data.measureNumber} 小节`:''}</p>{typeof data.note==='string'&&<p className="text-sm mt-1">{data.note}</p>}{typeof data.kind==='string'&&<p className="text-xs text-gray-500">{data.kind}</p>}</div>{cue&&<button className="btn-secondary text-xs py-1 px-2 flex items-center gap-1" onClick={()=>void replay(event)}><Play className="w-3 h-3" />回听提示</button>}</div>})}</div><button className="mt-4 text-sm text-gray-600 flex gap-1 items-center" onClick={()=>audioEngine.stopCue()}><Square className="w-3 h-3" />停止提示回听</button></section>
      </>}
    </main>
  </div>
}
