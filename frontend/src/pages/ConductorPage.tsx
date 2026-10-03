import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Users, Music, Plus, LogOut, Mic, PenLine, History, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useSocketStore } from '../stores/socketStore'
import ScoreViewer from '../components/score/ScoreViewer'
import AnnotationTools from '../components/conductor/AnnotationTools'
import CuePanel from '../components/conductor/CuePanel'
import MemberList from '../components/conductor/MemberList'
import RehearsalControls from '../components/conductor/RehearsalControls'
import ScoreTimeline from '../components/score/ScoreTimeline'
import FeedbackPanel from '../components/score/FeedbackPanel'
import LiveAudioPanel from '../components/audio/LiveAudioPanel'
import { useScoreSession } from '../score/scoreSession'
import { apiFetch } from '../utils/api'
import { SECTIONS } from '../types'
import type { Score } from '../types'

export default function ConductorPage() {
  const navigate = useNavigate()
  const { scoreId } = useParams()
  const {
    currentUser, currentEnsemble, currentScore, currentPage, addMark, removeMark,
    setCurrentEnsemble, setCurrentScore, setCurrentPage, clearState, isRehearsing,
  } = useAppStore()
  const { connect, disconnect, joinEnsemble, leaveEnsemble, setupEventListeners, isConnected, error: socketError } = useSocketStore()
  const [showMemberList, setShowMemberList] = useState(false)
  const [activeTool, setActiveTool] = useState<'select' | 'pen' | 'highlight' | 'text'>('select')
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [showControls, setShowControls] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const ensembleId = currentEnsemble?.id

  useEffect(() => {
    if (!ensembleId) navigate('/setup', { replace: true })
  }, [ensembleId, navigate])

  useEffect(() => {
    if (!currentUser || !ensembleId) return
    let cancelled = false
    connect()
    const cleanup = setupEventListeners({
      onMarkAdded: addMark,
      onMarkDeleted: removeMark,
      onPositionUpdated: (position) => {
        if (position.scoreId !== useAppStore.getState().currentScore?.id) return
        useScoreSession.getState().setPosition(position)
        useAppStore.getState().setCurrentMeasure(position.measure)
      },
      onMistakeReceived: useScoreSession.getState().addMistake,
      onPageChanged: (data) => {
        if (data.scoreId && data.scoreId !== useAppStore.getState().currentScore?.id) return
        setCurrentPage(data.page)
      },
      onMemberJoined: () => {
        apiFetch(`/api/ensembles/${ensembleId}`)
          .then(async (response) => {
            if (!response.ok) throw new Error('读取乐团信息失败')
            return response.json()
          })
          .then((ensemble) => { if (!cancelled) setCurrentEnsemble(ensemble) })
          .catch(() => {})
      },
    })
    joinEnsemble(ensembleId, currentUser)
    return () => {
      cancelled = true
      cleanup()
      leaveEnsemble(ensembleId)
    }
  }, [currentUser, ensembleId, connectionAttempt, connect, joinEnsemble, leaveEnsemble, setupEventListeners, addMark, removeMark, setCurrentEnsemble, setCurrentPage])

  useEffect(() => {
    if (!ensembleId) return
    let cancelled = false
    setError('')
    setIsLoading(true)
    if (scoreId && useAppStore.getState().currentScore?.id !== scoreId) setCurrentScore(null)
    const load = async () => {
      const response = await apiFetch(`/api/ensembles/${ensembleId}`)
      if (!response.ok) throw new Error('读取乐团失败，请重试')
      const ensemble = await response.json()
      if (cancelled) return
      setCurrentEnsemble(ensemble)
      const selectedId = scoreId || useAppStore.getState().currentScore?.id || ensemble.scores?.[0]?.id
      if (!selectedId) {
        setCurrentScore(null)
        return
      }
      const scoreResponse = await apiFetch(`/api/scores/${selectedId}?memberId=${encodeURIComponent(currentUser?.id || '')}`)
      if (!scoreResponse.ok) throw new Error('读取乐谱失败，请重试')
      const score: Score = await scoreResponse.json()
      if (score.ensembleId !== ensembleId) throw new Error('该乐谱不属于当前乐团')
      if (!cancelled) {
        setCurrentScore(score)
        if (!scoreId) navigate(`/conductor/score/${score.id}`, { replace: true })
      }
    }
    load().catch((failure) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : '读取乐谱失败')
    }).finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [ensembleId, scoreId, retryCount, setCurrentEnsemble, setCurrentScore, navigate])

  useEffect(() => {
    const socket = useSocketStore.getState().socket
    if (!socket || !isConnected || !currentUser) return
    const refreshTracks = (data: { scoreId: string }) => {
      if (data.scoreId !== useAppStore.getState().currentScore?.id) return
      void apiFetch(`/api/scores/${data.scoreId}?memberId=${encodeURIComponent(currentUser.id)}`).then(response => response.ok ? response.json() : null).then(score => { if (score && useAppStore.getState().currentScore?.id === score.id) setCurrentScore(score) }).catch(() => {})
    }
    socket.on('score-tracks-updated', refreshTracks)
    socket.on('score-layout-updated', refreshTracks)
    return () => { socket.off('score-tracks-updated', refreshTracks); socket.off('score-layout-updated', refreshTracks) }
  }, [isConnected, currentUser?.id, setCurrentScore])

  useEffect(() => {
    if (isConnected && currentScore) {
      useSocketStore.getState().socket?.emit('score-select', { scoreId: currentScore.id })
    }
  }, [isConnected, currentScore?.id])

  const handleLogout = () => {
    disconnect()
    clearState()
    navigate('/')
  }

  if (!currentUser || !currentEnsemble) {
    return null
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* 顶部工具栏 */}
      <header className="bg-white border-b border-gray-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-bold text-gray-900">{currentEnsemble.name}</h1>
          <span className="text-sm text-gray-500 hidden lg:inline">指挥: {currentUser.name}</span>
          <label className="text-sm text-gray-600">
            乐谱
            <select
              aria-label="选择乐谱"
              value={currentScore?.id || ''}
              disabled={isLoading || isRehearsing}
              onChange={(event) => navigate(`/conductor/score/${event.target.value}`)}
              className="ml-2 border rounded px-2 py-1 max-w-52"
            >
              <option value="" disabled>请选择乐谱</option>
              {currentEnsemble.scores.map((score) => <option key={score.id} value={score.id}>{score.title}</option>)}
            </select>
          </label>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm px-2 py-1 flex items-center gap-1" disabled={isRehearsing} onClick={() => navigate('/notation')}><PenLine className="w-4 h-4" />新建总谱</button>
          {currentScore?.fileType === 'musicxml' && <button className="text-sm text-blue-700 px-2" disabled={isRehearsing} onClick={() => navigate(`/notation/${currentScore.id}`)}>编辑此谱</button>}
          <button className="p-2 text-gray-600" title="排练复盘" onClick={() => navigate('/review')}><History className="w-5 h-5" /></button>
          <button className="p-2 text-gray-600 lg:hidden" title="控制面板" onClick={() => setShowControls(value => !value)}><SlidersHorizontal className="w-5 h-5" /></button>
          <button 
            onClick={() => setShowMemberList(!showMemberList)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title="成员列表"
          >
            <Users className="w-5 h-5" />
          </button>
          <button 
            onClick={() => navigate('/upload')}
            disabled={isRehearsing}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            title="上传乐谱"
          >
            <Plus className="w-5 h-5" />
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

      <div className="bg-white border-b px-4 py-2 text-xs text-gray-500 break-all">
        乐团ID（分享给乐手）：<span className="font-mono select-all">{currentEnsemble.id}</span>
      </div>
      <div className="bg-white border-b px-3 py-1.5 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-gray-500">批注对象</span><select aria-label="批注对象" className="border rounded p-1 max-w-48" value={selectedMemberId ? `member:${selectedMemberId}` : selectedSection ? `section:${selectedSection}` : 'all'} onChange={e => { setSelectedSection(e.target.value.startsWith('section:') ? e.target.value.slice(8) : null); setSelectedMemberId(e.target.value.startsWith('member:') ? e.target.value.slice(7) : null) }}><option value="all">全体</option><optgroup label="声部">{SECTIONS.map(section => <option key={section.id} value={`section:${section.id}`}>{section.name}</option>)}</optgroup><optgroup label="个人">{currentEnsemble.members.filter(member => member.role === 'PLAYER').map(member => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}</optgroup></select><span className="text-gray-500">圈画与批注自动保存、实时同步</span>
      </div>
      {error && (
        <div role="alert" className="bg-red-50 text-red-700 px-4 py-2 text-sm">
          {error}<button className="ml-3 underline" onClick={() => setRetryCount((count) => count + 1)}>重试</button>
        </div>
      )}
      {socketError && (
        <div role="alert" className="bg-amber-50 text-amber-800 px-4 py-2 text-sm">
          {socketError}
          {!isConnected && <button className="ml-3 underline" onClick={() => { disconnect(); setConnectionAttempt((attempt) => attempt + 1) }}>重新连接</button>}
        </div>
      )}
      {/* 主内容区 */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* 左侧工具栏 */}
        <aside className="w-12 sm:w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-2 flex-shrink-0">
          <AnnotationTools 
            activeTool={activeTool} 
            onToolChange={setActiveTool}
          />
        </aside>

        {/* 中间乐谱区 */}
        <main className="flex-1 min-w-0 overflow-hidden relative">
          {currentScore ? (
            <ScoreViewer 
              score={currentScore}
              activeTool={activeTool}
              selectedSection={selectedSection}
              selectedMemberId={selectedMemberId}
              isConductor={true}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Music className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">还没有选择乐谱</p>
                <button 
                  onClick={() => navigate('/upload')}
                  className="btn-primary"
                >
                  上传乐谱
                </button>
              </div>
            </div>
          )}
        </main>

        {/* 右侧面板 */}
        <aside className={`w-80 max-w-[90vw] bg-white border-l border-gray-200 flex-col flex-shrink-0 overflow-y-auto lg:static lg:flex ${showControls ? 'absolute right-0 inset-y-0 z-40 flex shadow-xl' : 'hidden'}`}>
          <button className="lg:hidden text-sm text-gray-500 p-2 text-right border-b" onClick={() => setShowControls(false)}>关闭控制面板</button>
          {currentScore && <ScoreTimeline score={currentScore} />}
          {showMemberList ? (
            <MemberList 
              ensembleId={currentEnsemble.id}
              onSelectSection={(section) => { setSelectedSection(section); setSelectedMemberId(null) }}
              selectedSection={selectedSection}
            />
          ) : (
            <>
              <CuePanel 
                selectedSection={selectedSection}
                currentScore={currentScore}
              />
              <RehearsalControls />
              <FeedbackPanel />
              <details><summary className="p-3 text-sm font-medium cursor-pointer">实时语音通道</summary><LiveAudioPanel /></details>
            </>
          )}
        </aside>
      </div>

      {/* 底部状态栏 */}
      <footer className="bg-white border-t border-gray-200 px-4 h-10 flex items-center justify-between text-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className={`flex items-center gap-1 ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? '已连接' : '未连接'}
          </span>
          <span className="text-gray-500">当前页: {currentPage}</span>
        </div>
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-gray-400" />
          <span className="text-gray-500">声部提示与实时语音</span>
        </div>
      </footer>
    </div>
  )
}
