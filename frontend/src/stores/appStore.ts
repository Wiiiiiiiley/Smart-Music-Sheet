import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Ensemble, Score, Mark, CursorPosition } from '../types'

interface AppState {
  // 当前用户
  currentUser: User | null
  setCurrentUser: (user: User | null) => void
  
  // 当前乐团
  currentEnsemble: Ensemble | null
  setCurrentEnsemble: (ensemble: Ensemble | null) => void
  
  // 当前乐谱
  currentScore: Score | null
  setCurrentScore: (score: Score | null) => void
  
  // 当前页码
  currentPage: number
  setCurrentPage: (page: number) => void
  
  // 当前小节
  currentMeasure: number
  setCurrentMeasure: (measure: number) => void
  
  // 标记列表
  marks: Mark[]
  liveMarks: Record<string, Mark>
  deletedMarkIds: Record<string, boolean>
  addMark: (mark: Mark) => void
  removeMark: (markId: string) => void
  setMarks: (marks: Mark[]) => void
  
  // 在线成员光标位置
  cursorPositions: Record<string, CursorPosition>
  updateCursorPosition: (position: CursorPosition) => void
  removeCursorPosition: (memberId: string) => void
  
  // 排练状态
  isRehearsing: boolean
  rehearsalStartTime: Date | null
  currentRehearsalId: string | null
  startRehearsal: (rehearsalId?: string, startedAt?: string) => void
  stopRehearsal: () => void
  
  // 音频设置
  masterVolume: number
  setMasterVolume: (volume: number) => void
  sectionVolumes: Record<string, number>
  setSectionVolume: (section: string, volume: number) => void
  
  // 清除所有状态
  clearState: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // 用户
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),
      
      // 乐团
      currentEnsemble: null,
      setCurrentEnsemble: (ensemble) => set((state) => ({
        currentEnsemble: ensemble,
        ...(state.currentEnsemble?.id !== ensemble?.id || (state.currentScore && state.currentScore.ensembleId !== ensemble?.id) ? {
          currentScore: null, marks: [], currentPage: 1, currentMeasure: 1,
          liveMarks: {}, deletedMarkIds: {},
          cursorPositions: {}, isRehearsing: false, rehearsalStartTime: null,
          currentRehearsalId: null,
        } : {}),
      })),
      
      // 乐谱
      currentScore: null,
      setCurrentScore: (score) => set((state) => ({
        currentScore: score,
        // An HTTP snapshot may arrive after newer socket edits or deletions.
        marks: score ? Array.from(new Map([
          ...(score.marks || []),
          ...Object.values(state.liveMarks).filter((mark) => mark.scoreId === score.id),
        ].filter((mark) => !state.deletedMarkIds[mark.id]).map((mark) => [mark.id, mark])).values()) : [],
        ...(state.currentScore?.id !== score?.id ? { currentPage: 1, currentMeasure: 1 } : {}),
      })),
      
      // 页面
      currentPage: 1,
      setCurrentPage: (page) => set({ currentPage: Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1 }),
      
      // 小节
      currentMeasure: 1,
      setCurrentMeasure: (measure) => set({ currentMeasure: Number.isFinite(measure) ? Math.max(1, Math.floor(measure)) : 1 }),
      
      // 标记
      marks: [],
      liveMarks: {},
      deletedMarkIds: {},
      addMark: (mark) => set((state) => ({
        liveMarks: { ...state.liveMarks, [mark.id]: mark },
        deletedMarkIds: { ...state.deletedMarkIds, [mark.id]: false },
        marks: mark.scoreId === state.currentScore?.id
          ? [...state.marks.filter((existing) => existing.id !== mark.id), mark]
          : state.marks,
      })),
      removeMark: (markId) => set((state) => ({
        marks: state.marks.filter((m) => m.id !== markId),
        deletedMarkIds: { ...state.deletedMarkIds, [markId]: true },
      })),
      setMarks: (marks) => set({ marks }),
      clearState: () => set({
        currentUser: null,
        currentEnsemble: null,
        currentScore: null,
        marks: [],
        liveMarks: {},
        deletedMarkIds: {},
        currentPage: 1,
        currentMeasure: 1,
        cursorPositions: {},
        isRehearsing: false,
        rehearsalStartTime: null,
        currentRehearsalId: null,
      }),
      
      // 光标位置
      cursorPositions: {},
      updateCursorPosition: (position) => set((state) => ({
        cursorPositions: {
          ...state.cursorPositions,
          [position.memberId]: position
        }
      })),
      removeCursorPosition: (memberId) => set((state) => {
        const newPositions = { ...state.cursorPositions }
        delete newPositions[memberId]
        return { cursorPositions: newPositions }
      }),
      
      // 排练状态
      isRehearsing: false,
      rehearsalStartTime: null,
      currentRehearsalId: null,
      startRehearsal: (rehearsalId, startedAt) => set({ 
        isRehearsing: true, 
        rehearsalStartTime: startedAt ? new Date(startedAt) : new Date(),
        currentRehearsalId: rehearsalId || null,
      }),
      stopRehearsal: () => set({ 
        isRehearsing: false, 
        rehearsalStartTime: null,
        currentRehearsalId: null,
      }),
      
      // 音频设置
      masterVolume: 1,
      setMasterVolume: (volume) => set({ masterVolume: volume }),
      sectionVolumes: {},
      setSectionVolume: (section, volume) => set((state) => ({
        sectionVolumes: {
          ...state.sectionVolumes,
          [section]: volume
        }
      })),
      
      // 清除
      // clearState 已在前面定义
    }),
    {
      name: 'edutempo-storage',
      partialize: (state) => ({
        currentUser: state.currentUser,
        currentEnsemble: state.currentEnsemble,
        currentScore: state.currentScore,
        masterVolume: state.masterVolume,
        sectionVolumes: state.sectionVolumes,
      })
    }
  )
)
