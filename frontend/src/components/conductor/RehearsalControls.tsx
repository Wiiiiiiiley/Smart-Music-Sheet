import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSocketStore } from '../../stores/socketStore'
import { apiFetch } from '../../utils/api'
import type { Rehearsal } from '../../types'
import RecordingControls from '../audio/RecordingControls'

export default function RehearsalControls() {
  const {
    isRehearsing, startRehearsal, stopRehearsal, currentScore, currentEnsemble,
    currentRehearsalId,
  } = useAppStore()
  const { startRehearsal: emitStart, stopRehearsal: emitStop, isConnected } = useSocketStore()
  const navigate = useNavigate()
  const [isSaving, setIsSaving] = useState(true)
  const [error, setError] = useState('')
  const rehearsalScoreRef = useRef<string | null>(null)
  const ensembleId = currentEnsemble?.id

  useEffect(() => {
    if (!ensembleId) return
    let cancelled = false
    setIsSaving(true)
    apiFetch(`/api/rehearsals?ensembleId=${encodeURIComponent(ensembleId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('读取排练记录失败')
        return response.json() as Promise<Rehearsal[]>
      })
      .then((rehearsals) => {
        const active = rehearsals.find((rehearsal) => !rehearsal.endedAt)
        if (!cancelled && active) {
          rehearsalScoreRef.current = active.scoreId || null
          if (active.scoreId) navigate(`/conductor/score/${active.scoreId}`, { replace: true })
          startRehearsal(active.id, active.startedAt)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsSaving(false) })
    return () => { cancelled = true }
  }, [ensembleId, startRehearsal, navigate])

  useEffect(() => {
    if (isConnected && isRehearsing && currentRehearsalId && currentScore &&
      (!rehearsalScoreRef.current || rehearsalScoreRef.current === currentScore.id)) {
      emitStart({ scoreId: currentScore.id, rehearsalId: currentRehearsalId })
    }
  }, [isConnected, isRehearsing, currentRehearsalId, currentScore?.id, emitStart])

  const handleStart = async () => {
    if (!currentScore || !currentEnsemble || isSaving) return
    setIsSaving(true)
    setError('')
    try {
      const response = await apiFetch('/api/rehearsals/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ensembleId: currentEnsemble.id, scoreId: currentScore.id }),
      })
      if (!response.ok) throw new Error('开始排练失败，请重试')
      const rehearsal: Rehearsal = await response.json()
      rehearsalScoreRef.current = currentScore.id
      startRehearsal(rehearsal.id, rehearsal.startedAt)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '开始排练失败')
    } finally {
      setIsSaving(false)
    }
  }

  const handleStop = async () => {
    if (isSaving) return
    setIsSaving(true)
    setError('')
    try {
      if (currentRehearsalId) {
        const response = await apiFetch(`/api/rehearsals/${currentRehearsalId}/end`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
        if (!response.ok) throw new Error('结束排练失败，请重试')
      }
      stopRehearsal()
      emitStop()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '结束排练失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 border-t">
      <h3 className="font-semibold text-gray-900 mb-3">排练控制</h3>
      {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="flex gap-2">
        {!isRehearsing ? (
          <button onClick={handleStart} disabled={!currentScore || isSaving} className="flex-1 btn-conductor flex items-center justify-center gap-2">
            <Play className="w-4 h-4" />
            {isSaving ? '保存中...' : '开始排练'}
          </button>
        ) : (
          <button onClick={handleStop} disabled={isSaving} className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
            <Square className="w-4 h-4" />
            {isSaving ? '保存中...' : '停止排练'}
          </button>
        )}
      </div>
      {isRehearsing && (
        <div className="mt-4 p-3 bg-green-50 rounded-lg">
          <div className="flex items-center gap-2 text-green-700">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium">排练进行中</span>
          </div>
        </div>
      )}
      <RecordingControls />
    </div>
  )
}
