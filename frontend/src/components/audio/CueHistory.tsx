import { useEffect, useState } from 'react'
import { History, Play } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSocketStore } from '../../stores/socketStore'
import { apiFetch } from '../../utils/api'
import { audioEngine, type PlaybackCue } from '../../audio/audioEngine'
import { acceptsCue, appendCue, cueLabels, readCue } from '../../audio/cueHistory'

export default function CueHistory() {
  const { currentUser, currentEnsemble } = useAppStore()
  const { socket } = useSocketStore()
  const [history, setHistory] = useState<PlaybackCue[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    setHistory([])
    setError('')
    if (!currentEnsemble || !currentUser) return
    const controller = new AbortController()
    void apiFetch(`/api/ensembles/${currentEnsemble.id}/cues?memberId=${encodeURIComponent(currentUser.id)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('读取提示历史失败')
        const raw = await response.json() as unknown[]
        const values = raw.map(readCue).filter((cue): cue is PlaybackCue => Boolean(cue && acceptsCue(cue, currentUser)))
        setHistory(previous => values.slice(-20).reduce(appendCue, previous).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(-20))
      }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '提示历史加载失败') })
    return () => controller.abort()
  }, [currentEnsemble?.id, currentUser?.id])

  useEffect(() => {
    if (!socket) return
    const receive = (raw: unknown) => { const cue = readCue(raw); if (cue && acceptsCue(cue, useAppStore.getState().currentUser)) setHistory(previous => appendCue(previous, cue)) }
    socket.on('cue-received', receive)
    return () => { socket.off('cue-received', receive) }
  }, [socket])

  const replay = async (cue: PlaybackCue) => {
    setError('')
    try { await audioEngine.playCue(cue) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '提示回听失败') }
  }

  return <details className="border-t pt-3" aria-label="关键提示回听">
    <summary className="text-sm font-medium flex gap-2 items-center cursor-pointer"><History className="w-4 h-4" />关键提示回听 ({history.length})</summary>
    <div className="mt-2 space-y-1 max-h-56 overflow-auto">
      {history.slice().reverse().map((cue, index) => <button key={`${cue.timestamp}-${index}`} onClick={() => void replay(cue)} className="w-full rounded bg-gray-50 text-left p-2 text-xs flex gap-2 items-center">
        <Play className="w-3 h-3 flex-shrink-0 text-indigo-600" />
        <span className="flex-1">{cueLabels[cue.type]}{cue.measureNumber ? ` · 第 ${cue.measureNumber} 小节` : ''}</span>
        <span className="text-gray-400">{cue.timestamp ? new Date(cue.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </button>)}
      {!history.length && <p className="text-xs text-gray-500 p-2">排练中的关键提示会保存在这里，点击可回听。</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  </details>
}
