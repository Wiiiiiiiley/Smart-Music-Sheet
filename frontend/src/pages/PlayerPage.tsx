import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Headphones, Volume2, LogOut, History } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useSocketStore } from '../stores/socketStore'
import ScoreViewer from '../components/score/ScoreViewer'
import AudioMixer from '../components/player/AudioMixer'
import CueReceiver from '../components/player/CueReceiver'
import AnnotationTools from '../components/conductor/AnnotationTools'
import ScoreTimeline from '../components/score/ScoreTimeline'
import FeedbackPanel from '../components/score/FeedbackPanel'
import LiveAudioPanel from '../components/audio/LiveAudioPanel'
import { useScoreSession } from '../score/scoreSession'
import { apiFetch, resolveAssetUrl } from '../utils/api'
import type { Ensemble, Score } from '../types'

export default function PlayerPage() {
  const navigate = useNavigate()
  const { ensembleId } = useParams()
  const location = useLocation()
  const {
    currentUser, currentEnsemble, currentScore, currentPage, clearState,
    setCurrentUser, setCurrentEnsemble, setCurrentScore, addMark, removeMark,
    setCurrentPage, setCurrentMeasure, startRehearsal, stopRehearsal,
    masterVolume, sectionVolumes, isRehearsing,
  } = useAppStore()
  const {
    connect, disconnect, joinEnsemble, leaveEnsemble,
    setupEventListeners, isConnected, error: socketError,
  } = useSocketStore()
  const [showAudioMixer, setShowAudioMixer] = useState(false)
  const [activeTool, setActiveTool] = useState<'select' | 'pen' | 'highlight' | 'text'>('select')
  const [isJoining, setIsJoining] = useState(false)
  const [joinedEnsembleId, setJoinedEnsembleId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const targetEnsembleId = ensembleId || (location.pathname !== '/player/join' ? currentEnsemble?.id : undefined)
  const userId = currentUser?.id

  useEffect(() => {
    if (!targetEnsembleId || !currentUser) {
      setJoinedEnsembleId(null)
      return
    }
    let cancelled = false
    setIsJoining(true)
    setError('')
    setJoinedEnsembleId(null)
    const load = async () => {
      const response = await apiFetch(`/api/ensembles/${targetEnsembleId}`)
      if (!response.ok) throw new Error('乐团不存在，请检查ID')
      const ensemble: Ensemble = await response.json()
      const memberResponse = await apiFetch(`/api/ensembles/${targetEnsembleId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentUser, id: currentUser.id, role: 'PLAYER' }),
      })
      if (!memberResponse.ok) throw new Error('登记乐团成员失败，请重试')
      const member = await memberResponse.json()
      if (cancelled) return
      setCurrentUser({ ...currentUser, id: member.id, ensembleId: targetEnsembleId })
      setCurrentEnsemble({ ...ensemble, members: [...ensemble.members.filter((existing) => existing.id !== member.id), member] })
      const previousScore = useAppStore.getState().currentScore
      const selectedId = previousScore?.ensembleId === targetEnsembleId ? previousScore.id : ensemble.scores?.[0]?.id
      if (selectedId) {
        const scoreResponse = await apiFetch(`/api/scores/${selectedId}?memberId=${encodeURIComponent(member.id)}`)
        if (!scoreResponse.ok) throw new Error('读取乐谱失败，请重试')
        const score: Score = await scoreResponse.json()
        if (!cancelled) setCurrentScore(score)
      } else if (!cancelled) {
        setCurrentScore(null)
      }
      if (!cancelled) setJoinedEnsembleId(targetEnsembleId)
    }
    load().catch((failure) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : '加入失败，请重试')
    }).finally(() => { if (!cancelled) setIsJoining(false) })
    return () => { cancelled = true }
  }, [targetEnsembleId, userId, retryCount, setCurrentUser, setCurrentEnsemble, setCurrentScore])

  useEffect(() => {
    if (!joinedEnsembleId || !currentUser) return
    let cancelled = false
    let pendingPage = useAppStore.getState().currentPage
    let pendingScoreId = useAppStore.getState().currentScore?.id
    let pendingPosition = useScoreSession.getState().position
    let scoreRequest = 0
    const loadScore = async (scoreId: string) => {
      pendingScoreId = scoreId
      const request = ++scoreRequest
      const response = await apiFetch(`/api/scores/${scoreId}?memberId=${encodeURIComponent(currentUser.id)}`)
      if (!response.ok) throw new Error('读取指挥选择的乐谱失败')
      const score: Score = await response.json()
      if (!cancelled && request === scoreRequest && score.ensembleId === joinedEnsembleId) {
        setCurrentScore(score)
        setCurrentPage(pendingPage)
        if (pendingPosition?.scoreId === score.id) { setCurrentMeasure(pendingPosition.measure); useScoreSession.getState().setPosition(pendingPosition) }
      }
    }
    connect()
    const cleanup = setupEventListeners({
      onMarkAdded: addMark,
      onMarkDeleted: removeMark,
      onScoreSelected: (data) => {
        if (!data.scoreId) return
        if (data.scoreId !== useAppStore.getState().currentScore?.id) pendingPage = 1
        loadScore(data.scoreId).catch((failure) => { if (!cancelled) setError(failure.message) })
      },
      onPageChanged: (data) => {
        if (data.scoreId && data.scoreId !== pendingScoreId) return
        const page = Number(data.page)
        if (Number.isFinite(page) && page >= 1) {
          pendingPage = page
          setCurrentPage(page)
        }
      },
      onPositionUpdated: (data) => {
        if (data.scoreId === pendingScoreId) pendingPosition = data
        if (data.scoreId && data.scoreId !== useAppStore.getState().currentScore?.id) return
        if (Number.isFinite(data.measure)) { setCurrentMeasure(data.measure); useScoreSession.getState().setPosition(data) }
      },
      onMistakeReceived: useScoreSession.getState().addMistake,
      onRehearsalStarted: (data) => {
        startRehearsal(data.rehearsalId, data.startedAt)
        if (data.scoreId && data.scoreId !== useAppStore.getState().currentScore?.id) {
          loadScore(data.scoreId).catch((failure) => { if (!cancelled) setError(failure.message) })
        }
      },
      onRehearsalStopped: stopRehearsal,
    })
    joinEnsemble(joinedEnsembleId, currentUser)
    const refreshScore = (data: { scoreId: string }) => { if (data.scoreId === useAppStore.getState().currentScore?.id) void loadScore(data.scoreId).catch(failure => { if (!cancelled) setError(failure.message) }) }
    const socket = useSocketStore.getState().socket
    socket?.on('score-tracks-updated', refreshScore)
    socket?.on('score-layout-updated', refreshScore)
    return () => {
      cancelled = true
      cleanup()
      socket?.off('score-tracks-updated', refreshScore)
      socket?.off('score-layout-updated', refreshScore)
      leaveEnsemble(joinedEnsembleId)
    }
  }, [joinedEnsembleId, currentUser, connectionAttempt, connect, joinEnsemble, leaveEnsemble, setupEventListeners, addMark, removeMark, setCurrentScore, setCurrentPage, setCurrentMeasure, startRehearsal, stopRehearsal])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, masterVolume * (sectionVolumes.demo ?? 1))
  }, [masterVolume, sectionVolumes.demo, currentScore?.audioUrl])

  const handleLogout = () => {
    disconnect()
    clearState()
    navigate('/')
  }

  if (!targetEnsembleId) {
    return <JoinEnsembleView onJoin={(id) => navigate(`/player/${encodeURIComponent(id)}`)} />
  }
  if (!currentUser) return null
  if (isJoining || !joinedEnsembleId) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="panel p-8 text-center space-y-4">
          {error ? <p role="alert" className="text-red-600">{error}</p> : <p>正在加入乐团...</p>}
          {error && <button className="btn-primary" onClick={() => setRetryCount((count) => count + 1)}>重试</button>}
          <button className="btn-secondary ml-2" onClick={() => navigate('/player/join')}>输入其他乐团ID</button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* 顶部工具栏 */}
      <header className="bg-white border-b border-gray-200 px-3 py-2 flex flex-wrap gap-2 items-center justify-between flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-bold text-gray-900">{currentEnsemble?.name || '乐团排练'}</h1>
          <span className="text-sm text-gray-500">{currentUser.name}</span>
          {currentUser.section && (
            <span className="text-sm px-2 py-0.5 bg-primary-100 text-primary-700 rounded">
              {getSectionName(currentUser.section)}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button title="排练复盘" className="p-2 text-gray-600" onClick={() => navigate('/review')}><History className="w-5 h-5" /></button>
          <button 
            onClick={() => setShowAudioMixer(!showAudioMixer)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title="排练与音频面板"
          >
            <Headphones className="w-5 h-5" />
          </button>
          <button 
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-gray-100 text-red-500"
            title="退出"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {error && <p role="alert" className="bg-red-50 text-red-700 px-4 py-2 text-sm">{error}</p>}
      {socketError && (
        <div role="alert" className="bg-amber-50 text-amber-800 px-4 py-2 text-sm">
          {socketError}
          {!isConnected && <button className="ml-3 underline" onClick={() => { disconnect(); setConnectionAttempt((attempt) => attempt + 1) }}>重新连接</button>}
        </div>
      )}
      {currentScore?.audioUrl && (
        <div className="bg-white border-b px-4 py-2 flex items-center gap-3">
          <span className="text-sm text-gray-600">参考音频</span>
          <audio ref={audioRef} key={currentScore.audioUrl} controls src={resolveAssetUrl(currentScore.audioUrl)} className="h-8 flex-1" />
        </div>
      )}
      {/* 主内容区 */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        <aside className="w-12 sm:w-16 bg-white border-r flex flex-col items-center py-3 shrink-0"><AnnotationTools activeTool={activeTool} onToolChange={setActiveTool} /><span className="text-[10px] text-gray-500 text-center px-1 mt-3">我的批注<br />仅自己可见</span></aside>
        {/* 乐谱区 */}
        <main className="flex-1 min-w-0 overflow-hidden relative">
          {currentScore ? (
            <ScoreViewer 
              score={currentScore}
              activeTool={activeTool}
              isConductor={false}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Volume2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">等待指挥选择乐谱...</p>
              </div>
            </div>
          )}
        </main>

        {/* 右侧面板 */}
          <aside className={`w-80 max-w-[90vw] bg-white border-l border-gray-200 flex-shrink-0 overflow-y-auto absolute right-0 inset-y-0 z-40 shadow-xl lg:static lg:shadow-none ${showAudioMixer ? '' : 'hidden'}`}>
            <button className="text-sm text-gray-500 p-2 text-right border-b w-full" onClick={() => setShowAudioMixer(false)}>关闭面板</button>
            {currentScore && <ScoreTimeline score={currentScore} />}
            <FeedbackPanel />
            <LiveAudioPanel />
            <AudioMixer />
          </aside>
      </div>

      {/* 提示接收器 */}
      <CueReceiver />

      {/* 底部状态栏 */}
      <footer className="bg-white border-t border-gray-200 px-4 h-10 flex items-center justify-between text-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className={`flex items-center gap-1 ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? '已连接' : '未连接'}
          </span>
          <span className="text-gray-500">第 {currentPage} 页{isRehearsing ? ' · 排练中' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <Headphones className="w-4 h-4 text-gray-400" />
          <span className="text-gray-500">佩戴耳机以获得最佳体验</span>
        </div>
      </footer>
    </div>
  )
}

// 加入乐团界面
function JoinEnsembleView({ onJoin }: { onJoin: (id: string) => void }) {
  const [ensembleId, setEnsembleId] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const [error, setError] = useState('')

  const handleJoin = async () => {
    if (!ensembleId.trim()) return
    
    setIsJoining(true)
    setError('')
    
    try {
      const response = await apiFetch(`/api/ensembles/${ensembleId.trim()}`)
      if (response.ok) {
        onJoin(ensembleId.trim())
      } else {
        setError('乐团不存在，请检查ID')
      }
    } catch (error) {
      setError('加入失败，请重试')
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-gray-50">
      <div className="panel p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">加入乐团</h1>
          <p className="text-gray-600">输入乐团ID加入排练</p>
        </div>

        <div className="space-y-4">
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              乐团ID
            </label>
            <input
              type="text"
              value={ensembleId}
              onChange={(e) => setEnsembleId(e.target.value)}
              placeholder="请输入乐团ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            onClick={handleJoin}
            disabled={!ensembleId.trim() || isJoining}
            className="w-full btn-primary"
          >
            {isJoining ? '加入中...' : '加入乐团'}
          </button>
        </div>

        <div className="mt-6 pt-6 border-t text-center">
          <p className="text-sm text-gray-500">
            不知道乐团ID？请联系指挥获取
          </p>
        </div>
      </div>
    </div>
  )
}

function getSectionName(section: string): string {
  const sectionMap: Record<string, string> = {
    violin1: '第一小提琴',
    violin2: '第二小提琴',
    viola: '中提琴',
    cello: '大提琴',
    bass: '低音提琴',
    flute: '长笛',
    oboe: '双簧管',
    clarinet: '单簧管',
    bassoon: '大管',
    horn: '圆号',
    trumpet: '小号',
    trombone: '长号',
    tuba: '大号',
    timpani: '定音鼓',
    percussion: '打击乐',
    piano: '钢琴',
    harp: '竖琴',
  }
  return sectionMap[section] || section
}
