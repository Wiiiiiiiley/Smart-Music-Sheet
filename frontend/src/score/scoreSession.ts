import { create } from 'zustand'
import type { MeasureRegion, RehearsalPosition, MistakeReport } from '../types'
import type { TimedMeasure } from './timeline'

interface ScoreSession {
  timelines: Record<string, TimedMeasure[]>
  regions: Record<string, MeasureRegion[]>
  position: RehearsalPosition | null
  mistakes: MistakeReport[]
  setTimeline: (id: string, timeline: TimedMeasure[]) => void
  setRegions: (id: string, regions: MeasureRegion[]) => void
  setPosition: (position: RehearsalPosition) => void
  addMistake: (mistake: MistakeReport) => void
}

export const useScoreSession = create<ScoreSession>(set => ({
  timelines: {}, regions: {}, position: null, mistakes: [],
  setTimeline: (id, timeline) => set(state => ({ timelines: { ...state.timelines, [id]: timeline } })),
  setRegions: (id, regions) => set(state => ({ regions: { ...state.regions, [id]: regions } })),
  setPosition: position => set({ position }),
  addMistake: mistake => set(state => ({ mistakes: [mistake, ...state.mistakes.filter(item => item.id !== mistake.id)].slice(0, 100) })),
}))
