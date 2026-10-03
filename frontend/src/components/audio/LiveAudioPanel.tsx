import { useEffect, useRef, useState } from 'react'
import { Headphones, Mic, MicOff, Radio } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSocketStore } from '../../stores/socketStore'
import { SECTIONS } from '../../types'
import { audioEngine } from '../../audio/audioEngine'
import { LiveAudioSession, type PeerHealth } from '../../audio/LiveAudioSession'
import AudioDiagnostic from './AudioDiagnostic'

const states = { new: '等待', connecting: '连接中', connected: '已连接', disconnected: '连接中断', failed: '连接失败', closed: '已关闭' }

export default function LiveAudioPanel() {
  const { currentUser, currentEnsemble, masterVolume, sectionVolumes } = useAppStore()
  const { socket, isConnected, joinAudioRoom, leaveAudioRoom } = useSocketStore()
  const session = useRef<LiveAudioSession>()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [target, setTarget] = useState('all')
  const [health, setHealth] = useState<PeerHealth[]>([])
  const conductor = currentUser?.role === 'CONDUCTOR'

  useEffect(() => {
    if (!socket || !currentUser || !currentEnsemble) return
    if (typeof RTCPeerConnection === 'undefined') { setError('当前浏览器不支持 WebRTC，请使用新版 Chrome、Safari 或 Edge'); return }
    const connection = new LiveAudioSession(socket, currentUser, setHealth, setError)
    session.current = connection
    setEnabled(false)
    return () => { session.current?.stop(); session.current = undefined; leaveAudioRoom() }
  }, [socket, currentUser?.id, currentEnsemble?.id, leaveAudioRoom])

  useEffect(() => { audioEngine.setVolumes(masterVolume, sectionVolumes) }, [masterVolume, sectionVolumes])

  const begin = async () => {
    if (!session.current || !currentUser || !currentEnsemble) return
    setBusy(true)
    setError('')
    try {
      const connection = session.current
      if (conductor) await connection.startMicrophone()
      else await connection.enableListening()
      if (connection !== session.current) return
      if (target.startsWith('section:')) await connection.setTarget(target.slice(8))
      else if (target.startsWith('member:')) await connection.setTarget(undefined, target.slice(7))
      // Announce readiness after the audio graph is unlocked. A conductor may have
      // offered before a player pressed Listen, so that first offer is retried.
      leaveAudioRoom()
      joinAudioRoom(currentEnsemble.id, currentUser)
      setEnabled(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '启用实时音频失败')
    } finally { setBusy(false) }
  }

  const changeTarget = async (value: string) => {
    setTarget(value)
    try { await session.current?.setTarget(value.startsWith('section:') ? value.slice(8) : undefined, value.startsWith('member:') ? value.slice(7) : undefined) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '切换音频对象失败') }
  }

  const stop = () => {
    session.current?.stop()
    if (socket && currentUser) session.current = new LiveAudioSession(socket, currentUser, setHealth, setError)
    leaveAudioRoom()
    setEnabled(false)
    setHealth([])
  }

  return <section className="p-4 space-y-3 border-t" aria-label="实时音频">
    <h3 className="font-semibold flex gap-2 items-center"><Radio className="w-4 h-4" />{conductor ? '指挥实时讲话' : '指挥实时音频'}</h3>
    {conductor && <label className="block text-sm">讲话对象
      <select className="input w-full mt-1" value={target} onChange={event => void changeTarget(event.target.value)}>
        <option value="all">全体乐手</option>
        {SECTIONS.map(section => <option key={section.id} value={`section:${section.id}`}>{section.name}</option>)}
        {currentEnsemble?.members.filter(member => member.role === 'PLAYER').map(member => <option key={member.id} value={`member:${member.id}`}>{member.name}（个人）</option>)}
      </select>
    </label>}
    <button onClick={enabled ? stop : () => void begin()} disabled={busy || !isConnected} className={`w-full px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2 ${enabled ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-indigo-600 text-white disabled:opacity-50'}`}>
      {conductor ? enabled ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
      {busy ? '启用中…' : enabled ? conductor ? '关闭麦克风' : '停止接收音频' : conductor ? '开启麦克风' : '接收指挥音频'}
    </button>
    {enabled && <p className="text-xs text-gray-500">{conductor ? '麦克风已开启，请佩戴耳机。' : '已准备好接收指挥声音，请佩戴耳机。'}{!isConnected && '正在重连实时房间…'}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {health.map(peer => <div key={peer.memberId} className="text-xs bg-gray-50 rounded p-2">
      <p>{currentEnsemble?.members.find(member => member.id === peer.memberId)?.name || (conductor ? '乐手' : '指挥')} · {states[peer.state]}</p>
      {peer.rttMs !== undefined && <p>网络往返 {peer.rttMs.toFixed(1)} ms{peer.relay ? ' · 中继' : ' · 直连'}</p>}
      {peer.jitterMs !== undefined && <p>抖动 {peer.jitterMs.toFixed(1)} ms · 接收缓冲 {peer.bufferMs?.toFixed(1) ?? '—'} ms</p>}
    </div>)}
    {enabled && health.length === 0 && <p className="text-xs text-gray-500">{conductor ? '等待乐手启用接收音频' : '等待指挥开启麦克风'}</p>}
    <p className="text-xs text-gray-400">连接指标为浏览器实测值；网络往返时间与单程音频延迟不同。</p>
    <AudioDiagnostic />
  </section>
}
