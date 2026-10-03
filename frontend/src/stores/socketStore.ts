import { create } from 'zustand'
import { io } from 'socket.io-client'
import { realtimeConfig } from '../utils/api'
import { WorkerSocket, type RealtimeSocket } from '../utils/workerSocket'
import type { User, Mark, CursorPosition, RehearsalPosition, MistakeReport } from '../types'


let ensembleJoin: { ensembleId: string; memberId: string; role: string; section?: string } | undefined
let audioJoin: typeof ensembleJoin

interface SocketState {
  socket: RealtimeSocket | null
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  roomMembers: Array<{
    socketId: string
    memberId: string
    role: string
    section?: string
  }>
  
  // 方法
  connect: () => void
  disconnect: () => void
  joinEnsemble: (ensembleId: string, user: User) => void
  leaveEnsemble: (ensembleId: string) => void
  joinAudioRoom: (ensembleId: string, user: User) => void
  leaveAudioRoom: () => void
  
  // 标记相关
  sendMark: (mark: Omit<Mark, 'id' | 'createdAt' | 'creator'>) => void
  deleteMark: (markId: string) => void
  
  // 提示相关
  sendCue: (cue: {
    type: 'CLICK' | 'COUNT_IN' | 'METRONOME' | 'DEMO_AUDIO'
    targetSection?: string
    targetMemberId?: string
    measureNumber?: number
    bpm?: number
    audioUrl?: string
    timeSignature?: string
    stop?: boolean
  }) => void
  
  // 光标同步
  sendCursorPosition: (position: Omit<CursorPosition, 'memberId' | 'role'>) => void
  
  // 排练控制
  startRehearsal: (data: { scoreId: string; rehearsalId: string }) => void
  stopRehearsal: () => void
  sendPosition: (position: RehearsalPosition) => void
  
  // WebRTC 信令
  sendWebRTCOffer: (to: string, signal: any) => void
  sendWebRTCAnswer: (to: string, signal: any) => void
  sendWebRTCIceCandidate: (to: string, signal: any) => void
  sendAudioControl: (control: {
    targetSection?: string
    targetMemberId?: string
    action: 'MUTE' | 'UNMUTE' | 'SET_VOLUME'
    volume?: number
  }) => void
  
  // 设置监听
  setupEventListeners: (callbacks: {
    onMarkAdded?: (mark: Mark) => void
    onMarkDeleted?: (markId: string) => void
    onCueReceived?: (cue: any) => void
    onCursorMoved?: (position: CursorPosition) => void
    onMemberJoined?: (member: any) => void
    onMemberLeft?: (data: any) => void
    onRoomMembers?: (members: any[]) => void
    onRehearsalStarted?: (data: any) => void
    onRehearsalStopped?: () => void
    onPositionUpdated?: (data: any) => void
    onMistakeReceived?: (data: MistakeReport) => void
    onWebRTCOffer?: (data: any) => void
    onWebRTCAnswer?: (data: any) => void
    onWebRTCIceCandidate?: (data: any) => void
    onAudioControl?: (control: any) => void
    onCueAudio?: (data: any) => void
    onScoreSelected?: (data: { scoreId: string }) => void
    onPageChanged?: (data: { page: number; scoreId?: string }) => void
  }) => () => void
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  isConnecting: false,
  error: null,
  roomMembers: [],
  
  connect: () => {
    if (get().socket) return
    set({ isConnecting: true, error: null })
    const config = realtimeConfig()
    const socket: RealtimeSocket = config.transport === 'websocket'
      ? new WorkerSocket(config.url)
      : io(config.url, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 5 })
    socket.on('connect', () => {
      if (!(socket instanceof WorkerSocket) && ensembleJoin) {
        socket.emit('join-ensemble', ensembleJoin)
        if (audioJoin) socket.emit('join-audio-room', audioJoin)
      }
    })
    socket.on('disconnect', () => set({ isConnected: false, isConnecting: false, roomMembers: [] }))
    socket.on('connect_error', (error) => set({ isConnecting: false, error: error.message }))
    socket.on('error', (error) => set({ error: error.message || '实时操作失败' }))
    socket.on('room-members', (members) => set({ roomMembers: members, isConnected: true, isConnecting: false, error: null }))
    socket.on('member-joined', (member) => set((state) => ({
      roomMembers: [...state.roomMembers.filter(m => m.socketId !== member.socketId), member]
    })))
    socket.on('member-left', (data) => set((state) => ({
      roomMembers: state.roomMembers.filter(m => m.socketId !== data.socketId)
    })))
    set({ socket })
  },

  disconnect: () => {
    ensembleJoin = undefined
    audioJoin = undefined
    const socket = get().socket
    if (socket) {
      socket.disconnect()
      set({ socket: null, isConnected: false, isConnecting: false, error: null, roomMembers: [] })
    }
  },
  
  joinEnsemble: (ensembleId: string, user: User) => {
    const socket = get().socket
    if (!socket) return
    
    ensembleJoin = { ensembleId, memberId: user.id, role: user.role, section: user.section }
    set({ isConnected: false, isConnecting: true })
    if (socket instanceof WorkerSocket || socket.connected) socket.emit('join-ensemble', ensembleJoin)
  },
  
  leaveEnsemble: (ensembleId: string) => {
    const socket = get().socket
    if (socket) {
      socket.emit('leave-ensemble', ensembleId)
      if (ensembleJoin?.ensembleId === ensembleId) ensembleJoin = undefined
      set({ isConnected: false, roomMembers: [] })
    }
  },
  
  joinAudioRoom: (ensembleId: string, user: User) => {
    const socket = get().socket
    if (!socket) return
    
    audioJoin = { ensembleId, memberId: user.id, role: user.role, section: user.section }
    if (socket instanceof WorkerSocket || socket.connected) socket.emit('join-audio-room', audioJoin)
  },
  
  leaveAudioRoom: () => {
    audioJoin = undefined
    const socket = get().socket
    if (socket) {
      socket.emit('leave-audio-room')
    }
  },
  
  sendMark: (mark) => {
    const socket = get().socket
    if (socket) {
      socket.emit('add-mark', mark)
    }
  },
  
  deleteMark: (markId) => {
    const socket = get().socket
    if (socket) {
      socket.emit('delete-mark', markId)
    }
  },
  
  sendCue: (cue) => {
    const socket = get().socket
    if (socket) {
      socket.emit('send-cue', cue)
    }
  },
  
  sendCursorPosition: (position) => {
    const socket = get().socket
    if (socket) {
      socket.emit('cursor-move', position)
    }
  },
  
  startRehearsal: (data) => {
    const socket = get().socket
    if (socket) {
      socket.emit('rehearsal-start', data)
    }
  },
  
  stopRehearsal: () => {
    const socket = get().socket
    if (socket) {
      socket.emit('rehearsal-stop')
    }
  },
  
  sendPosition: (position) => {
    const socket = get().socket
    if (socket) {
      socket.emit('current-position', position)
    }
  },
  
  sendWebRTCOffer: (to, signal) => {
    const socket = get().socket
    if (socket) {
      socket.emit('webrtc-offer', { to, from: socket.id, signal })
    }
  },
  
  sendWebRTCAnswer: (to, signal) => {
    const socket = get().socket
    if (socket) {
      socket.emit('webrtc-answer', { to, from: socket.id, signal })
    }
  },
  
  sendWebRTCIceCandidate: (to, signal) => {
    const socket = get().socket
    if (socket) {
      socket.emit('webrtc-ice-candidate', { to, from: socket.id, signal })
    }
  },
  
  sendAudioControl: (control) => {
    const socket = get().socket
    if (socket) {
      socket.emit('audio-control', control)
    }
  },
  
  setupEventListeners: (callbacks) => {
    const socket = get().socket
    if (!socket) return () => {}
    const events = {
      onMarkAdded: 'mark-added', onMarkDeleted: 'mark-deleted', onCueReceived: 'cue-received',
      onCursorMoved: 'cursor-moved', onMemberJoined: 'member-joined', onMemberLeft: 'member-left',
      onRoomMembers: 'room-members', onRehearsalStarted: 'rehearsal-started',
      onRehearsalStopped: 'rehearsal-stopped', onPositionUpdated: 'position-updated',
      onWebRTCOffer: 'webrtc-offer', onWebRTCAnswer: 'webrtc-answer',
      onWebRTCIceCandidate: 'webrtc-ice-candidate', onAudioControl: 'audio-control',
      onCueAudio: 'cue-audio', onScoreSelected: 'score-selected', onPageChanged: 'page-changed',
      onMistakeReceived: 'mistake-received'
    } as const
    const listeners: Array<[string, (data?: any) => void]> = []
    for (const key of Object.keys(events) as Array<keyof typeof events>) {
      const callback = callbacks[key]
      if (callback) {
        const listener = callback as (data?: any) => void
        socket.on(events[key], listener)
        listeners.push([events[key], listener])
      }
    }
    return () => { for (const [event, listener] of listeners) socket.off(event, listener) }
  }
}))
