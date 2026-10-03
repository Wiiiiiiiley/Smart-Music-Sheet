// 用户角色
export type UserRole = 'CONDUCTOR' | 'PLAYER'

// 用户
export interface User {
  id: string
  name: string
  role: UserRole
  instrument?: string
  section?: string // 声部，如 "violin", "cello"
  ensembleId?: string
}

// 乐团
export interface Ensemble {
  id: string
  name: string
  conductorId: string
  members: Member[]
  scores: Score[]
  createdAt: string
}

// 成员
export interface Member {
  id: string
  name: string
  role: UserRole
  instrument?: string
  section?: string
  ensembleId: string
}

// 乐谱
export interface Score {
  id: string
  title: string
  composer?: string
  fileUrl: string
  fileType: 'pdf' | 'musicxml'
  audioUrl?: string
  audioTracks?: AudioTrack[]
  measureRegions?: MeasureRegion[]
  ensembleId: string
  measures: Measure[]
  marks: Mark[]
  createdAt: string
}

export interface AudioTrack {
  id: string
  label: string
  section?: string
  audioUrl: string
  volume?: number
}

export interface MeasureRegion {
  number: number
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface RehearsalPosition {
  scoreId: string
  measure: number
  beat?: number
  bpm?: number
  beatsPerMeasure?: number
  running?: boolean
  startedAt?: number
  entryMeasures?: Record<string, number>
}

export interface MistakeReport {
  id: string
  scoreId: string
  measure: number
  kind: string
  note: string
  targetSection?: string
  targetMemberId?: string
  timestamp: number
}

// 小节
export interface Measure {
  id: string
  number: number
  scoreId: string
  startTime?: number // 音频起始时间（秒）
  endTime?: number   // 音频结束时间（秒）
  cues: Cue[]
}

// 标记类型
export type MarkType = 'DRAWING' | 'TEXT' | 'HIGHLIGHT'

// 标记
export interface Mark {
  id: string
  type: MarkType
  data: string // JSON 序列化的数据
  x: number
  y: number
  width?: number
  height?: number
  page: number
  scoreId: string
  creatorId: string
  creator?: {
    name: string
    role: UserRole
    section?: string
  }
  targetSection?: string // 目标声部
  targetMemberId?: string
  private?: boolean
  measureId?: string
  createdAt: string
}

// 提示类型
export type CueType = 'CLICK' | 'COUNT_IN' | 'METRONOME' | 'DEMO_AUDIO'

// 提示
export interface Cue {
  id: string
  type: CueType
  measureId: string
  targetSection?: string
  targetMemberId?: string
  audioUrl?: string
  bpm?: number
  timeSignature?: string
}

// 排练
export interface Rehearsal {
  id: string
  ensembleId: string
  scoreId?: string
  startedAt: string
  endedAt?: string
  recordingUrl?: string
  events: RehearsalEvent[]
}

// 排练事件
export interface RehearsalEvent {
  id: string
  rehearsalId: string
  type: string
  data: string
  timestamp: string
}

// 光标位置
export interface CursorPosition {
  x: number
  y: number
  page: number
  memberId: string
  role: UserRole
}

// 绘图路径
export interface DrawingPath {
  points: { x: number; y: number }[]
  color: string
  width: number
}

// WebSocket 消息类型
export interface SocketMessage {
  type: string
  payload: any
  timestamp: number
  senderId: string
}

// 音频控制
export interface AudioControl {
  action: 'MUTE' | 'UNMUTE' | 'SET_VOLUME'
  targetSection?: string
  targetMemberId?: string
  volume?: number
}

// 声部定义
export const SECTIONS = [
  { id: 'violin1', name: '第一小提琴', color: '#ef4444' },
  { id: 'violin2', name: '第二小提琴', color: '#f97316' },
  { id: 'viola', name: '中提琴', color: '#eab308' },
  { id: 'cello', name: '大提琴', color: '#22c55e' },
  { id: 'bass', name: '低音提琴', color: '#06b6d4' },
  { id: 'flute', name: '长笛', color: '#3b82f6' },
  { id: 'oboe', name: '双簧管', color: '#8b5cf6' },
  { id: 'clarinet', name: '单簧管', color: '#a855f7' },
  { id: 'bassoon', name: '大管', color: '#ec4899' },
  { id: 'horn', name: '圆号', color: '#f43f5e' },
  { id: 'trumpet', name: '小号', color: '#10b981' },
  { id: 'trombone', name: '长号', color: '#0ea5e9' },
  { id: 'tuba', name: '大号', color: '#6366f1' },
  { id: 'timpani', name: '定音鼓', color: '#8b5cf6' },
  { id: 'percussion', name: '打击乐', color: '#d946ef' },
  { id: 'piano', name: '钢琴', color: '#64748b' },
  { id: 'harp', name: '竖琴', color: '#84cc16' },
] as const
