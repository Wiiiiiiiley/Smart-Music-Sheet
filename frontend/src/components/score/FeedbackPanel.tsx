import { useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useSocketStore } from '../../stores/socketStore'
import { useScoreSession } from '../../score/scoreSession'
import { SECTIONS } from '../../types'

export default function FeedbackPanel() {
  const { currentScore, currentUser, currentEnsemble, currentMeasure } = useAppStore()
  const { socket, isConnected } = useSocketStore()
  const mistakes = useScoreSession(state => state.mistakes)
  const [kind, setKind] = useState('错音')
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('all')
  const reports = mistakes.filter(item => item.scoreId === currentScore?.id && (currentUser?.role === 'CONDUCTOR' || ((!item.targetSection || item.targetSection === currentUser?.section) && (!item.targetMemberId || item.targetMemberId === currentUser?.id))))
  return <details className="border-b p-3 text-sm" open={reports.length > 0}>
    <summary className="font-medium cursor-pointer">演奏反馈{reports.length > 0 ? ` · ${reports.length}` : ''}</summary>
    {currentUser?.role === 'CONDUCTOR' && <div className="space-y-2 mt-3">
      <p className="text-xs text-gray-500">指挥标记错音、节奏和技术问题，乐手立即收到并可在复盘中查看。</p>
      <select aria-label="反馈对象" className="w-full border rounded p-1" value={target} onChange={e => setTarget(e.target.value)}><option value="all">全体</option><optgroup label="声部">{SECTIONS.map(section => <option value={`section:${section.id}`} key={section.id}>{section.name}</option>)}</optgroup><optgroup label="乐手">{currentEnsemble?.members.filter(member => member.role === 'PLAYER').map(member => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}</optgroup></select>
      <div className="flex gap-2"><select aria-label="失误类型" className="border rounded p-1" value={kind} onChange={e => setKind(e.target.value)}>{['错音','节奏','进拍','演奏技巧'].map(value => <option key={value}>{value}</option>)}</select><span className="text-xs p-1 text-gray-500">第 {currentMeasure} 小节</span></div>
      <input aria-label="演奏反馈内容" className="w-full border rounded p-2" maxLength={500} placeholder="例如：第二拍 F 要升高半音" value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn-secondary text-xs px-2 py-1" disabled={!isConnected || !currentScore || !note.trim()} onClick={() => { socket?.emit('send-mistake', { scoreId: currentScore?.id, measure: currentMeasure, kind, note: note.trim(), ...(target.startsWith('section:') ? { targetSection: target.slice(8) } : target.startsWith('member:') ? { targetMemberId: target.slice(7) } : {}) }); setNote('') }}>发送反馈</button>
    </div>}
    <div className="max-h-40 overflow-auto space-y-2 mt-2">{reports.slice(0,10).map(item => <div key={item.id} role="status" className="rounded bg-amber-50 p-2"><strong>第 {item.measure} 小节 · {item.kind}</strong><p>{item.note}</p></div>)}</div>
    {!reports.length && currentUser?.role === 'PLAYER' && <p className="text-xs text-gray-500 mt-2">收到的指挥演奏反馈会显示在这里。</p>}
  </details>
}
