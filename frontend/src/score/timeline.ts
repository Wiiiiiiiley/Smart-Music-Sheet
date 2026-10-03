import JSZip from 'jszip'
import type { MeasureRegion } from '../types'

export interface TimedMeasure {
  number: number
  startTime: number
  endTime: number
  bpm: number
  beats: number
  beatType: number
  soundingParts: string[]
}

export async function unpackXml(bytes: Uint8Array): Promise<string> {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes)
    const container = zip.file('META-INF/container.xml')
    const doc = container ? new DOMParser().parseFromString(await container.async('string'), 'text/xml') : null
    const path = doc?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
    const file = path ? zip.file(path) : Object.values(zip.files).find(entry => !entry.dir && /\.(xml|musicxml)$/i.test(entry.name) && !entry.name.startsWith('META-INF/'))
    if (!file) throw new Error('压缩乐谱缺少 MusicXML 文件')
    return file.async('string')
  }
  return new TextDecoder(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8').decode(bytes)
}

const elements = (el: Element) => Array.from(el.childNodes).filter((node): node is Element => node.nodeType === 1)
const child = (el: Element, tag: string) => elements(el).find(item => item.tagName === tag)
const num = (el: Element | undefined, fallback: number) => {
  const value = Number(el?.textContent)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

// Timeline follows written measures. Repeats are controlled by the conductor's measure selector.
export function xmlTimeline(xml: string): TimedMeasure[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('MusicXML 格式无效')
  const parts = Array.from(doc.getElementsByTagName('part'))
  if (!parts.length) throw new Error('乐谱缺少声部')
  const all = parts.map(part => {
    let divisions = 1, beats = 4, beatType = 4, bpm = 120
    return elements(part).filter(el => el.tagName === 'measure').map((measure, index) => {
      const attributes = child(measure, 'attributes')
      if (attributes) {
        divisions = num(child(attributes, 'divisions'), divisions)
        const time = child(attributes, 'time')
        if (time) {
          const beatsText = child(time, 'beats')?.textContent || ''
          const additive = beatsText.split('+').reduce((sum, val) => sum + Number(val), 0)
          beats = additive > 0 ? additive : beats
          beatType = num(child(time, 'beat-type'), beatType)
        }
      }
      const tempo = Array.from(measure.getElementsByTagName('sound')).map(el => Number(el.getAttribute('tempo'))).find(value => value > 0)
      if (tempo) bpm = tempo
      let position = 0, maximum = 0, sounds = false
      for (const item of elements(measure)) {
        const duration = num(child(item, 'duration'), 0) / divisions
        if (item.tagName === 'backup') position -= duration
        if (item.tagName === 'forward') { position += duration; maximum = Math.max(maximum, position) }
        if (item.tagName === 'note') {
          if (!child(item, 'rest')) sounds = true
          if (!child(item, 'chord') && !child(item, 'grace')) { position += duration; maximum = Math.max(maximum, position) }
        }
      }
      const implicit = measure.getAttribute('implicit') === 'yes'
      const quarterBeats = implicit && maximum > 0 ? maximum : Math.max(maximum, beats * 4 / beatType)
      return { number: index + 1, quarterBeats, beats, beatType, bpm, sounds, partId: part.getAttribute('id') || '' }
    })
  })
  let seconds = 0
  return all[0].map((measure, i) => {
    const duration = Math.max(...all.map(part => part[i]?.quarterBeats || 0)) * 60 / measure.bpm
    const result: TimedMeasure = { number: measure.number, bpm: measure.bpm, beats: measure.beats, beatType: measure.beatType, startTime: seconds, endTime: seconds + duration, soundingParts: all.filter(part => part[i]?.sounds).map(part => part[i].partId) }
    seconds += duration
    return result
  })
}

export function regularTimeline(count: number, bpm: number, beats: number, beatType = 4): TimedMeasure[] {
  const duration = beats * 4 / beatType * 60 / bpm
  return Array.from({ length: count }, (_, index) => ({ number: index + 1, startTime: index * duration, endTime: (index + 1) * duration, bpm, beats, beatType, soundingParts: [] }))
}

// Detect horizontal staff runs, then vertical bars spanning a staff. Candidates need review
// because scans, beams, multi-staff systems and cropped pages can be ambiguous.
export function detectPdfBars(pixels: ImageData, page: number, startNumber: number): MeasureRegion[] {
  const { data, width, height } = pixels
  const ink = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return data[i + 3] > 100 && data[i] + data[i + 1] + data[i + 2] < 450
  }
  const rows: number[] = []
  for (let y = 0; y < height; y++) {
    let count = 0
    for (let x = Math.round(width * .05); x < width * .95; x++) if (ink(x, y)) count++
    if (count > width * .35 && (!rows.length || y - rows[rows.length - 1] > 2)) rows.push(y)
  }
  const staffs: number[][] = []
  for (let i = 0; i + 4 < rows.length; i++) {
    const set = rows.slice(i, i + 5)
    const gap = (set[4] - set[0]) / 4
    if (gap >= 3 && gap <= width / 20 && set.slice(1).every((y, j) => Math.abs(y - set[j] - gap) < Math.max(2, gap * .25))) {
      staffs.push(set); i += 4
    }
  }
  const regions: MeasureRegion[] = []
  const scale = 900 / width
  let number = startNumber
  for (const staff of staffs) {
    const top = staff[0], bottom = staff[4], gap = (bottom - top) / 4
    const xs: number[] = []
    for (let x = Math.round(width * .05); x < width * .95; x++) {
      let count = 0
      for (let y = top; y <= bottom; y++) if (ink(x, y)) count++
      if (count >= (bottom - top) * .88 && (!xs.length || x - xs[xs.length - 1] > gap)) xs.push(x)
    }
    for (let i = 0; i + 1 < xs.length; i++) {
      if (xs[i + 1] - xs[i] < gap * 3) continue
      regions.push({ number: number++, page, x: xs[i] * scale, y: Math.max(0, (top - gap * 2) * scale), width: (xs[i + 1] - xs[i]) * scale, height: gap * 8 * scale })
    }
  }
  return regions
}
