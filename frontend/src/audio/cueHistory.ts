import type { PlaybackCue } from './audioEngine'

export const cueLabels = { CLICK: '开始演奏', COUNT_IN: '预备拍', METRONOME: '节拍器', DEMO_AUDIO: '示范音频' }

export function readCue(value: unknown): PlaybackCue | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  let raw = item
  if (typeof item.data === 'string') {
    try { raw = JSON.parse(item.data) as Record<string, unknown> } catch { return null }
  } else if (item.data && typeof item.data === 'object') raw = item.data as Record<string, unknown>
  if (typeof raw.type !== 'string' || !(raw.type in cueLabels)) return null
  return { ...raw, timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : typeof item.timestamp === 'string' ? Date.parse(item.timestamp) : typeof item.timestamp === 'number' ? item.timestamp : Date.now() } as unknown as PlaybackCue
}

export function acceptsCue(cue: PlaybackCue, user: { id: string; role: string; section?: string } | null) {
  return user?.role === 'CONDUCTOR' || Boolean(user && (!cue.targetMemberId || cue.targetMemberId === user.id) && (!cue.targetSection || cue.targetSection === user.section))
}

export function appendCue(history: PlaybackCue[], cue: PlaybackCue) {
  const key = `${cue.timestamp}:${cue.type}:${cue.targetMemberId || cue.targetSection || ''}`
  return [...history.filter(existing => `${existing.timestamp}:${existing.type}:${existing.targetMemberId || existing.targetSection || ''}` !== key), cue].slice(-20)
}
