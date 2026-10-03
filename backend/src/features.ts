export type Viewer = { id: string; role: string; section?: string | null; ensembleId?: string }
export type AudioTrack = { id: string; label: string; section?: string; audioUrl: string; volume?: number }
export type Timing = { number: number; startTime?: number | null; endTime?: number | null }
export class FeatureError extends Error { constructor(message: string, public status = 400) { super(message) } }
export function parseJSON(value: unknown, fallback: any = {}) {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}
export function scoreJSON<T extends { audioTracks?: unknown; measureRegions?: unknown }>(score: T) { return { ...score, audioTracks: parseJSON(score.audioTracks, []), measureRegions: parseJSON(score.measureRegions, []) } }
export function canSeeMark(mark: any, viewer?: Viewer | null): boolean {
  if (mark.private) return viewer?.id === mark.creatorId
  return canReceiveTarget(mark, viewer)
}
export function canReceiveTarget(data: any, viewer?: Viewer | null): boolean {
  if (viewer?.role === 'CONDUCTOR') return true
  return (!data.targetMemberId || data.targetMemberId === viewer?.id) && (!data.targetSection || data.targetSection === viewer?.section)
}
export function canSeeEvent(event: { type: string; data: unknown }, viewer?: Viewer | null): boolean {
  const data = parseJSON(event.data)
  return data.private ? viewer?.id === data.creatorId : canReceiveTarget(data, viewer)
}
export function text(value: unknown, maximum = 1000): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : undefined
}
export function validateTracks(value: unknown): AudioTrack[] {
  if (!Array.isArray(value) || value.length > 32) throw new FeatureError('音轨列表无效（最多32条）')
  const ids = new Set<string>()
  return value.map(track => {
    const id = text(track?.id, 200), label = text(track?.label, 200), audioUrl = text(track?.audioUrl, 4000)
    if (!id || ids.has(id) || !label || !audioUrl || !/^(https?:\/\/|\/)/i.test(audioUrl)) throw new FeatureError('音轨名称或文件地址无效')
    if (track.volume !== undefined && (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1)) throw new FeatureError('音量必须在0到1之间')
    ids.add(id)
    return { id, label, audioUrl, ...(text(track.section, 100) ? { section: text(track.section, 100) } : {}), ...(track.volume !== undefined ? { volume: track.volume } : {}) }
  })
}
export function validateTimings(value: unknown): Timing[] {
  if (!Array.isArray(value) || value.length > 10000) throw new FeatureError('小节列表无效')
  const seen = new Set<number>()
  return value.map(measure => {
    if (!Number.isInteger(measure?.number) || measure.number < 1 || seen.has(measure.number)) throw new FeatureError('小节号必须是唯一的正整数')
    seen.add(measure.number)
    for (const field of ['startTime', 'endTime']) if (measure[field] !== undefined && measure[field] !== null && (!Number.isFinite(measure[field]) || measure[field] < 0)) throw new FeatureError('小节时间必须是非负数')
    if (measure.startTime != null && measure.endTime != null && measure.endTime < measure.startTime) throw new FeatureError('结束时间不能早于开始时间')
    return { number: measure.number, ...(measure.startTime !== undefined ? { startTime: measure.startTime } : {}), ...(measure.endTime !== undefined ? { endTime: measure.endTime } : {}) }
  }).sort((a, b) => a.number - b.number)
}
export function validatePosition(data: any, scoreId?: string) {
  if (!data || !Number.isInteger(data.measure) || data.measure < 1) throw new FeatureError('演奏位置无效')
  if (data.beat !== undefined && (!Number.isFinite(data.beat) || data.beat < 0 || data.beat > 32)) throw new FeatureError('拍数无效')
  if (data.bpm !== undefined && (!Number.isFinite(data.bpm) || data.bpm < 20 || data.bpm > 400)) throw new FeatureError('速度无效')
  if (data.beatsPerMeasure !== undefined && (!Number.isInteger(data.beatsPerMeasure) || data.beatsPerMeasure < 1 || data.beatsPerMeasure > 32)) throw new FeatureError('每小节拍数无效')
  if (data.running !== undefined && typeof data.running !== 'boolean') throw new FeatureError('演奏状态无效')
  if (data.startedAt !== undefined && !(Number.isFinite(data.startedAt) || (typeof data.startedAt === 'string' && Number.isFinite(Date.parse(data.startedAt))))) throw new FeatureError('开始时间无效')
  const entryMeasures: Record<string, number> = {}
  if (data.entryMeasures !== undefined) {
    if (!data.entryMeasures || typeof data.entryMeasures !== 'object' || Array.isArray(data.entryMeasures) || Object.keys(data.entryMeasures).length > 100) throw new FeatureError('声部进入小节无效')
    for (const [section, number] of Object.entries(data.entryMeasures)) {
      if (!text(section, 100) || !Number.isInteger(number) || Number(number) < 1) throw new FeatureError('声部进入小节无效')
      entryMeasures[section] = Number(number)
    }
  }
  return { scoreId: text(data.scoreId, 200) || scoreId, measure: data.measure, ...(data.beat !== undefined ? { beat: data.beat } : {}), ...(data.bpm !== undefined ? { bpm: data.bpm } : {}), ...(data.beatsPerMeasure !== undefined ? { beatsPerMeasure: data.beatsPerMeasure } : {}), ...(data.running !== undefined ? { running: data.running } : {}), ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}), ...(data.entryMeasures !== undefined ? { entryMeasures } : {}) }
}

export function validateRegions(value: unknown) {
  if (!Array.isArray(value) || value.length > 10000) throw new FeatureError('小节区域列表无效')
  const seen = new Set<string>()
  return value.map(region => {
    if (!Number.isInteger(region?.number) || region.number < 1 || !Number.isInteger(region.page) || region.page < 1) throw new FeatureError('区域小节号或页码无效')
    const key = `${region.page}:${region.number}`
    if (seen.has(key)) throw new FeatureError('同一页不能包含重复的小节区域')
    seen.add(key)
    for (const field of ['x', 'y', 'width', 'height']) if (!Number.isFinite(region[field]) || region[field] < 0) throw new FeatureError('区域坐标必须是非负数')
    if (!region.width || !region.height) throw new FeatureError('区域宽度和高度必须大于0')
    return { number: region.number, page: region.page, x: region.x, y: region.y, width: region.width, height: region.height }
  })
}
