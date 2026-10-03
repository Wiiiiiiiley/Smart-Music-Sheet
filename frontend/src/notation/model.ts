/** Quarter-note ticks match MIDI's PPQ; editing uses written pitch and playback applies instrument transposition. */
export const PPQ = 960
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export type Duration = 1 | 2 | 4 | 8 | 16 | 32 | 64
export type Clef = 'treble' | 'alto' | 'bass'
export interface Pitch { step: Step; octave: number; alter: number }
export interface NotationEvent {
  id: string
  tick: number
  voice: number
  duration: Duration
  dots: number
  triplet: boolean
  pitches: Pitch[] // An empty chord is a rest.
  tieNext?: boolean
  lyric?: string
  dynamic?: string
  articulation?: 'staccato' | 'accent' | 'tenuto'
}
export interface NotationMeasure { events: NotationEvent[] }
export interface NotationPart {
  id: string
  name: string
  abbreviation: string
  clef: Clef
  program: number
  transpose: number // Semitones from written pitch to sounding pitch.
  volume: number
  muted: boolean
  measures: NotationMeasure[]
}
export interface NotationScore {
  version: 1
  title: string
  composer: string
  fifths: number
  beats: number
  beatType: number
  bpm: number
  parts: NotationPart[]
}
export interface EditCursor { partId: string; measure: number; voice: number; tick: number }
export interface TimedNote {
  id: string; partId: string; measure: number; tick: number; duration: number; midi: number
  velocity: number
}

export const DURATIONS: { value: Duration; label: string; shortcut: string }[] = [
  { value: 64, label: '64 分', shortcut: '1' }, { value: 32, label: '32 分', shortcut: '2' },
  { value: 16, label: '16 分', shortcut: '3' }, { value: 8, label: '八分', shortcut: '4' },
  { value: 4, label: '四分', shortcut: '5' }, { value: 2, label: '二分', shortcut: '6' },
  { value: 1, label: '全音符', shortcut: '7' },
]
export const INSTRUMENTS: { name: string; abbreviation: string; clef: Clef; program: number; transpose: number }[] = [
  { name: '第一小提琴', abbreviation: 'Vln. I', clef: 'treble', program: 40, transpose: 0 },
  { name: '第二小提琴', abbreviation: 'Vln. II', clef: 'treble', program: 40, transpose: 0 },
  { name: '中提琴', abbreviation: 'Vla.', clef: 'alto', program: 41, transpose: 0 },
  { name: '大提琴', abbreviation: 'Vc.', clef: 'bass', program: 42, transpose: 0 },
  { name: '低音提琴', abbreviation: 'Cb.', clef: 'bass', program: 43, transpose: -12 },
  { name: '长笛', abbreviation: 'Fl.', clef: 'treble', program: 73, transpose: 0 },
  { name: '双簧管', abbreviation: 'Ob.', clef: 'treble', program: 68, transpose: 0 },
  { name: 'B♭ 单簧管', abbreviation: 'Cl.', clef: 'treble', program: 71, transpose: -2 },
  { name: '大管', abbreviation: 'Bsn.', clef: 'bass', program: 70, transpose: 0 },
  { name: 'F 圆号', abbreviation: 'Hn.', clef: 'treble', program: 60, transpose: -7 },
  { name: 'B♭ 小号', abbreviation: 'Tpt.', clef: 'treble', program: 56, transpose: -2 },
  { name: '长号', abbreviation: 'Tbn.', clef: 'bass', program: 57, transpose: 0 },
  { name: '大号', abbreviation: 'Tba.', clef: 'bass', program: 58, transpose: 0 },
  { name: '钢琴高音谱', abbreviation: 'Pno. R', clef: 'treble', program: 0, transpose: 0 },
  { name: '钢琴低音谱', abbreviation: 'Pno. L', clef: 'bass', program: 0, transpose: 0 },
  { name: '竖琴', abbreviation: 'Hp.', clef: 'treble', program: 46, transpose: 0 },
]

export function notationId(): string { return globalThis.crypto?.randomUUID?.() || `n-${Date.now()}-${Math.random().toString(36).slice(2)}` }
export function cloneScore(score: NotationScore): NotationScore { return JSON.parse(JSON.stringify(score)) as NotationScore }
export function measureTicks(score: Pick<NotationScore, 'beats' | 'beatType'>): number { return score.beats * PPQ * 4 / score.beatType }
export function eventTicks(event: Pick<NotationEvent, 'duration' | 'dots' | 'triplet'>): number {
  return Math.round(PPQ * 4 / event.duration * (2 - 1 / 2 ** event.dots) * (event.triplet ? 2 / 3 : 1))
}
export function makePart(instrument = INSTRUMENTS[0], measures = 4): NotationPart {
  return { id: notationId(), ...instrument, volume: 0.75, muted: false, measures: Array.from({ length: measures }, () => ({ events: [] })) }
}
export function createScore(): NotationScore {
  return { version: 1, title: '新的乐团总谱', composer: '', fifths: 0, beats: 4, beatType: 4, bpm: 100,
    parts: INSTRUMENTS.slice(0, 4).map(instrument => makePart(instrument)) }
}
export function pitchMidi(pitch: Pitch): number {
  return (pitch.octave + 1) * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[pitch.step] + pitch.alter
}
export function midiPitch(midi: number): Pitch {
  const steps: Step[] = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B']
  const semitone = ((midi % 12) + 12) % 12
  return { step: steps[semitone], octave: Math.floor(midi / 12) - 1, alter: [1, 3, 6, 8, 10].includes(semitone) ? 1 : 0 }
}
export function keyAlter(step: Step, fifths: number): number {
  const order = fifths >= 0 ? 'FCGDAEB' : 'BEADGCF'
  return order.slice(0, Math.abs(fifths)).includes(step) ? Math.sign(fifths) : 0
}
export function pitchAtCursor(score: NotationScore, cursor: EditCursor, step: Step, octave: number, accidental: number | null): Pitch {
  const part = score.parts.find(item => item.id === cursor.partId)
  const previous = part?.measures[cursor.measure]?.events.filter(event => event.tick < cursor.tick)
    .sort((a, b) => b.tick - a.tick).flatMap(event => event.pitches)
    .find(pitch => pitch.step === step && pitch.octave === octave)
  return { step, octave, alter: accidental ?? previous?.alter ?? keyAlter(step, score.fifths) }
}
export function partEvents(score: NotationScore, partId: string): { event: NotationEvent; measure: number; absoluteTick: number }[] {
  const part = score.parts.find(item => item.id === partId)
  const ticks = measureTicks(score)
  return part?.measures.flatMap((measure, index) => measure.events.map(event => ({ event, measure: index, absoluteTick: index * ticks + event.tick })))
    .sort((a, b) => a.absoluteTick - b.absoluteTick || a.event.voice - b.event.voice) || []
}
export function tiedNext(score: NotationScore, partId: string, eventId: string): NotationEvent | undefined {
  const events = partEvents(score, partId)
  const entry = events.find(item => item.event.id === eventId)
  if (!entry?.event.tieNext || !entry.event.pitches.length) return undefined
  const next = events.find(item => item.event.voice === entry.event.voice && item.absoluteTick === entry.absoluteTick + eventTicks(entry.event))?.event
  return next && next.pitches.length === entry.event.pitches.length && next.pitches.every(pitch => entry.event.pitches.some(other => pitchMidi(pitch) === pitchMidi(other))) ? next : undefined
}
export function addMeasure(score: NotationScore, after = score.parts[0].measures.length - 1): NotationScore {
  const next = cloneScore(score)
  for (const part of next.parts) part.measures.splice(after + 1, 0, { events: [] })
  return next
}
export function removeMeasure(score: NotationScore, index: number): NotationScore {
  if (score.parts[0].measures.length <= 1) throw new Error('总谱至少保留一个小节')
  const next = cloneScore(score)
  for (const part of next.parts) part.measures.splice(index, 1)
  return next
}
export function insertEvent(score: NotationScore, cursor: EditCursor, event: Omit<NotationEvent, 'id' | 'tick' | 'voice'>): { score: NotationScore; cursor: EditCursor; eventId: string } {
  let next = cloneScore(score)
  let position = { ...cursor }
  const ticks = eventTicks(event)
  const total = measureTicks(next)
  if (ticks > total) throw new Error('这个音符长于一个小节，请选择较短时值或用延音线连接')
  if (position.tick + ticks > total) position = { ...position, measure: position.measure + 1, tick: 0 }
  if (position.measure >= next.parts[0].measures.length) next = addMeasure(next)
  const part = next.parts.find(item => item.id === position.partId)
  if (!part) throw new Error('请选择一个乐器声部')
  const measure = part.measures[position.measure]
  // Overwrite mode removes overlapping events in the current voice; the remaining gaps become rests.
  measure.events = measure.events.filter(existing => existing.voice !== position.voice || existing.tick + eventTicks(existing) <= position.tick || existing.tick >= position.tick + ticks)
  const eventId = notationId()
  measure.events.push({ ...event, pitches: event.pitches.map(pitch => ({ ...pitch })), id: eventId, tick: position.tick, voice: position.voice })
  position.tick += ticks
  if (position.tick >= total) { position.tick = 0; position.measure += 1 }
  if (position.measure >= next.parts[0].measures.length) next = addMeasure(next)
  return { score: next, cursor: position, eventId }
}
export function updateEvent(score: NotationScore, partId: string, eventId: string, patch: Partial<NotationEvent>): NotationScore {
  const next = cloneScore(score)
  const part = next.parts.find(item => item.id === partId)
  if (!part) return next
  for (const measure of part.measures) {
    const index = measure.events.findIndex(event => event.id === eventId)
    if (index < 0) continue
    const updated = { ...measure.events[index], ...patch, id: eventId, tick: measure.events[index].tick, voice: measure.events[index].voice }
    if (updated.tick + eventTicks(updated) > measureTicks(next)) throw new Error('新的时值超过当前小节，请先移动到下一个小节')
    measure.events = measure.events.filter(event => event.id === eventId || event.voice !== updated.voice || event.tick + eventTicks(event) <= updated.tick || event.tick >= updated.tick + eventTicks(updated))
    const newIndex = measure.events.findIndex(event => event.id === eventId)
    measure.events[newIndex] = updated
  }
  return next
}
export function deleteEvent(score: NotationScore, eventId: string): NotationScore {
  const next = cloneScore(score)
  for (const part of next.parts) for (const measure of part.measures) measure.events = measure.events.filter(event => event.id !== eventId)
  return next
}
export function filledVoice(score: NotationScore, part: NotationPart, measureIndex: number, voice: number): NotationEvent[] {
  const source = part.measures[measureIndex].events.filter(event => event.voice === voice).sort((a, b) => a.tick - b.tick)
  const result: NotationEvent[] = []
  let tick = 0
  const fill = (until: number) => {
    let remaining = until - tick
    while (remaining > 0) {
      const candidates = DURATIONS.flatMap(({ value }) => [0, 1, 2].flatMap(dots => [false, true].map(triplet => ({ duration: value, dots, triplet }))));
      const match = candidates.sort((a, b) => eventTicks(b) - eventTicks(a)).find(item => eventTicks(item) <= remaining)
      if (!match) throw new Error('小节包含无法表示的时值，请调整为常规音符或三连音')
      result.push({ ...match, id: `rest-${measureIndex}-${voice}-${tick}`, tick, voice, pitches: [] })
      const length = eventTicks(match)
      tick += length; remaining -= length
    }
  }
  for (const event of source) { fill(event.tick); result.push(event); tick = event.tick + eventTicks(event) }
  fill(measureTicks(score))
  return result
}

export function validateScore(score: NotationScore): void {
  if (score.version !== 1 || !score.parts?.length || score.parts.length > 32) throw new Error('总谱须包含 1–32 个乐器声部')
  if (!Number.isInteger(score.beats) || score.beats < 1 || score.beats > 16 || ![2, 4, 8, 16].includes(score.beatType)) throw new Error('拍号须为 1–16 拍，分母为 2、4、8 或 16')
  if (!Number.isInteger(score.fifths) || Math.abs(score.fifths) > 7 || !Number.isFinite(score.bpm) || score.bpm < 20 || score.bpm > 300) throw new Error('调号或速度无效')
  const count = score.parts[0].measures.length
  if (!count || count > 200) throw new Error('可编辑 1–200 个小节')
  for (const part of score.parts) {
    if (part.measures.length !== count || !['treble', 'alto', 'bass'].includes(part.clef)) throw new Error('声部的小节数量或谱号不一致')
    for (const measure of part.measures) {
      for (let voice = 1; voice <= 4; voice++) {
        let end = 0
        for (const event of measure.events.filter(item => item.voice === voice).sort((a, b) => a.tick - b.tick)) {
          if (!DURATIONS.some(item => item.value === event.duration) || ![0, 1, 2].includes(event.dots) || !Number.isInteger(event.tick) || event.tick < end) throw new Error('音符时值无效，或同一声部中音符重叠')
          end = event.tick + eventTicks(event)
          if (end > measureTicks(score) || !event.pitches.every(pitch => 'CDEFGAB'.includes(pitch.step) && pitchMidi(pitch) >= 0 && pitchMidi(pitch) <= 127 && Number.isInteger(pitch.alter) && Math.abs(pitch.alter) <= 2)) throw new Error('音符超出小节或 MIDI 音域')
        }
      }
      if (measure.events.some(event => ![1, 2, 3, 4].includes(event.voice))) throw new Error('每个谱表支持 4 个独立声音')
    }
  }
}

const xmlEscape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const TYPE: Record<Duration, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd', 64: '64th' }
const DYNAMIC_VOLUME: Record<string, number> = { pp: 0.35, p: 0.5, mp: 0.65, mf: 0.8, f: 0.95, ff: 1 }

export function exportMusicXml(score: NotationScore): string {
  validateScore(score)
  const list = score.parts.map((part, index) => `<score-part id="P${index + 1}"><part-name>${xmlEscape(part.name)}</part-name><part-abbreviation>${xmlEscape(part.abbreviation)}</part-abbreviation><score-instrument id="I${index + 1}"><instrument-name>${xmlEscape(part.name)}</instrument-name></score-instrument><midi-device port="${Math.floor(index / 15) + 1}"/><midi-instrument id="I${index + 1}"><midi-channel>${index % 15 >= 9 ? index % 15 + 2 : index % 15 + 1}</midi-channel><midi-program>${part.program + 1}</midi-program></midi-instrument></score-part>`).join('')
  const parts = score.parts.map((part, partIndex) => {
    const incoming = new Set(partEvents(score, part.id).map(({ event }) => tiedNext(score, part.id, event.id)?.id).filter(Boolean))
    const measures = part.measures.map((measure, index) => {
      const clef = part.clef === 'bass' ? '<sign>F</sign><line>4</line>' : part.clef === 'alto' ? '<sign>C</sign><line>3</line>' : '<sign>G</sign><line>2</line>'
      const attributes = index === 0 ? `<attributes><divisions>${PPQ}</divisions><key><fifths>${score.fifths}</fifths></key><time><beats>${score.beats}</beats><beat-type>${score.beatType}</beat-type></time><clef>${clef}</clef>${part.transpose ? `<transpose><chromatic>${part.transpose}</chromatic></transpose>` : ''}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>` : ''
      const voices = Array.from(new Set([1, ...measure.events.map(event => event.voice)])).sort()
      const content = voices.map((voice, voiceIndex) => {
        const filled = filledVoice(score, part, index, voice)
        const notes = filled.map((event, eventIndex) => {
          const tieStart = !!tiedNext(score, part.id, event.id)
          const tieStop = incoming.has(event.id)
          const direction = event.dynamic && DYNAMIC_VOLUME[event.dynamic] ? `<direction><direction-type><dynamics><${event.dynamic}/></dynamics></direction-type><voice>${voice}</voice><sound dynamics="${Math.round(DYNAMIC_VOLUME[event.dynamic] * 100)}"/></direction>` : ''
          const pitches: (Pitch | null)[] = event.pitches.length ? event.pitches : [null]
          return direction + pitches.map((pitch, pitchIndex) => {
            const pitchXml = pitch ? `<pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>` : '<rest/>'
            const ties = pitch ? `${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}` : ''
            const next = filled[eventIndex + 1]
            let runOffset = 0
            for (let j = eventIndex - 1; j >= 0 && filled[j].triplet && filled[j].duration === event.duration && filled[j].dots === event.dots; j--) runOffset++
            const tripletStart = event.triplet && runOffset % 3 === 0
            const tripletStop = event.triplet && (!next?.triplet || next.duration !== event.duration || next.dots !== event.dots || runOffset % 3 === 2)
            const notations = `${tieStop && pitch ? '<tied type="stop"/>' : ''}${tieStart && pitch ? '<tied type="start"/>' : ''}${event.articulation && pitch ? `<articulations><${event.articulation}/></articulations>` : ''}${!pitchIndex && tripletStart ? '<tuplet type="start" number="1"/>' : ''}${!pitchIndex && tripletStop ? '<tuplet type="stop" number="1"/>' : ''}`
            return `<note>${pitchIndex ? '<chord/>' : ''}${pitchXml}<duration>${eventTicks(event)}</duration>${ties}<voice>${voice}</voice><type>${TYPE[event.duration]}</type>${'<dot/>'.repeat(event.dots)}${pitch && pitch.alter ? `<accidental>${pitch.alter === -2 ? 'flat-flat' : pitch.alter === -1 ? 'flat' : pitch.alter === 2 ? 'double-sharp' : 'sharp'}</accidental>` : ''}${event.triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : ''}${notations ? `<notations>${notations}</notations>` : ''}${event.lyric && !pitchIndex ? `<lyric><text>${xmlEscape(event.lyric)}</text></lyric>` : ''}</note>`
          }).join('')
        }).join('')
        return (voiceIndex ? `<backup><duration>${measureTicks(score)}</duration></backup>` : '') + notes
      }).join('')
      return `<measure number="${index + 1}">${attributes}${content}${index === part.measures.length - 1 ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>' : ''}</measure>`
    }).join('')
    return `<part id="P${partIndex + 1}">${measures}</part>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>${xmlEscape(score.title)}</work-title></work><identification><creator type="composer">${xmlEscape(score.composer)}</creator></identification><part-list>${list}</part-list>${parts}</score-partwise>`
}

function children(element: Element, tag: string): Element[] { return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).tagName === tag) }
function child(element: Element, tag: string): Element | undefined { return children(element, tag)[0] }
function content(element: Element | undefined, tag?: string): string { return (tag ? element && child(element, tag) : element)?.textContent?.trim() || '' }
function number(element: Element | undefined, tag: string, fallback: number): number { const text = content(element, tag); return text === '' ? fallback : Number(text) }
function inferredDuration(ticks: number): Pick<NotationEvent, 'duration' | 'dots' | 'triplet'> {
  for (const { value } of DURATIONS) for (const dots of [0, 1, 2]) for (const triplet of [false, true]) {
    const result = { duration: value, dots, triplet }
    if (eventTicks(result) === ticks) return result
  }
  throw new Error(`无法编辑 ${ticks} tick 的非常规时值；目前支持常规时值、双附点和三连音`)
}

/** Import notation semantics, never silently flatten unsupported meter or staff changes. */
export function parseMusicXml(xml: string, parser: DOMParser = new DOMParser()): NotationScore {
  const document = parser.parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length || document.documentElement.tagName !== 'score-partwise') throw new Error('请输入有效的 MusicXML partwise 总谱')
  const root = document.documentElement
  const partList = child(root, 'part-list')
  if (!partList) throw new Error('MusicXML 缺少乐器列表')
  const score: NotationScore = { version: 1, title: content(child(root, 'work'), 'work-title') || content(root, 'movement-title') || '导入的总谱', composer: '', fifths: 0, beats: 4, beatType: 4, bpm: 100, parts: [] }
  score.composer = children(child(root, 'identification') || root, 'creator').find(item => item.getAttribute('type') === 'composer')?.textContent || ''
  let haveMeter = false
  let haveKey = false
  let haveTempo = false
  for (const sourcePart of children(root, 'part')) {
    const definition = children(partList, 'score-part').find(item => item.getAttribute('id') === sourcePart.getAttribute('id'))
    if (!definition) throw new Error('MusicXML 声部名称缺失')
    const midiInstrument = child(definition, 'midi-instrument')
    const part: NotationPart = { id: notationId(), name: content(definition, 'part-name') || '乐器', abbreviation: content(definition, 'part-abbreviation'), clef: 'treble', program: number(midiInstrument, 'midi-program', 1) - 1, transpose: 0, volume: 0.75, muted: false, measures: [] }
    let divisions = 1
    let firstClef = ''
    for (const sourceMeasure of children(sourcePart, 'measure')) {
      const attributes = child(sourceMeasure, 'attributes')
      if (attributes) {
        divisions = number(attributes, 'divisions', divisions)
        if (!Number.isFinite(divisions) || divisions <= 0) throw new Error('MusicXML divisions 无效')
        if (number(attributes, 'staves', 1) > 1 || children(attributes, 'clef').length > 1) throw new Error('多谱表钢琴请先在 MuseScore 拆分为高音与低音声部，再导入；原文件仍可在排练中显示')
        const time = child(attributes, 'time')
        if (time) {
          const beats = number(time, 'beats', 4), beatType = number(time, 'beat-type', 4)
          if (haveMeter && (score.beats !== beats || score.beatType !== beatType)) throw new Error('此总谱含变拍号；编辑器目前支持全曲统一拍号，原文件仍可在排练中显示')
          score.beats = beats; score.beatType = beatType; haveMeter = true
        }
        const key = child(attributes, 'key')
        if (key) {
          const fifths = number(key, 'fifths', 0)
          if (haveKey && fifths !== score.fifths) throw new Error('此总谱含转调或各声部独立调号；编辑器目前支持全曲统一调号')
          score.fifths = fifths; haveKey = true
        }
        const clef = child(attributes, 'clef')
        if (clef) {
          const signature = `${content(clef, 'sign')}${content(clef, 'line')}`
          if (firstClef && firstClef !== signature) throw new Error('此声部含中途换谱号；请先拆分声部后编辑')
          if (!['G2', 'F4', 'C3'].includes(signature)) throw new Error('编辑器目前支持高音、中音和低音谱号')
          firstClef = signature; part.clef = signature === 'F4' ? 'bass' : signature === 'C3' ? 'alto' : 'treble'
        }
        const transpose = child(attributes, 'transpose')
        if (transpose) part.transpose = number(transpose, 'chromatic', 0) + number(transpose, 'octave-change', 0) * 12
      }
      const measure: NotationMeasure = { events: [] }
      let tick = 0
      let lastEvent: NotationEvent | undefined
      let pendingDynamic = ''
      for (const element of Array.from(sourceMeasure.childNodes).filter((node): node is Element => node.nodeType === 1)) {
        if (element.tagName === 'backup' || element.tagName === 'forward') { tick += Math.round(number(element, 'duration', 0) / divisions * PPQ) * (element.tagName === 'backup' ? -1 : 1); continue }
        if (element.tagName === 'direction') {
          const sound = child(element, 'sound')
          if (sound?.getAttribute('tempo')) {
            const tempo = Number(sound.getAttribute('tempo'))
            if (haveTempo && tempo !== score.bpm) throw new Error('此总谱含速度变化；编辑器目前支持全曲统一速度，原文件仍可直接上传排练')
            score.bpm = tempo; haveTempo = true
          }
          const dynamics = element.getElementsByTagName('dynamics')[0]
          pendingDynamic = dynamics && Array.from(dynamics.childNodes).find(node => node.nodeType === 1)?.nodeName || ''
          continue
        }
        if (element.tagName !== 'note') continue
        if (child(element, 'grace') || child(element, 'unpitched')) throw new Error('装饰音或无固定音高打击乐暂不支持编辑；原文件仍可直接上传排练')
        const voice = number(element, 'voice', 1)
        const durationTicks = Math.round(number(element, 'duration', 0) / divisions * PPQ)
        const shape = inferredDuration(durationTicks)
        const pitchElement = child(element, 'pitch')
        const pitch: Pitch | null = pitchElement ? { step: content(pitchElement, 'step') as Step, octave: number(pitchElement, 'octave', 4), alter: number(pitchElement, 'alter', 0) } : null
        if (child(element, 'chord')) {
          if (!lastEvent || !pitch || lastEvent.voice !== voice || eventTicks(lastEvent) !== durationTicks) throw new Error('MusicXML 和弦的声部或时值不一致')
          lastEvent.pitches.push(pitch)
          continue
        }
        const articulations = element.getElementsByTagName('articulations')[0]
        const articulation = articulations && Array.from(articulations.childNodes).find(node => ['staccato', 'accent', 'tenuto'].includes(node.nodeName))?.nodeName as NotationEvent['articulation']
        const event: NotationEvent = { id: notationId(), tick, voice, ...shape, pitches: pitch ? [pitch] : [],
          tieNext: children(element, 'tie').some(tie => tie.getAttribute('type') === 'start'),
          lyric: content(child(element, 'lyric'), 'text') || undefined, dynamic: pendingDynamic || undefined, articulation }
        pendingDynamic = ''
        measure.events.push(event); lastEvent = event; tick += durationTicks
      }
      part.measures.push(measure)
    }
    score.parts.push(part)
  }
  const count = Math.max(...score.parts.map(part => part.measures.length))
  for (const part of score.parts) while (part.measures.length < count) part.measures.push({ events: [] })
  validateScore(score)
  return score
}

export function timeline(score: NotationScore): TimedNote[] {
  const result: TimedNote[] = []
  for (const part of score.parts) {
    let volume = 0.8
    const incoming = new Set<string>()
    const entries = partEvents(score, part.id)
    for (const { event, measure, absoluteTick } of entries) {
      if (event.dynamic) volume = DYNAMIC_VOLUME[event.dynamic] || volume
      if (incoming.has(event.id)) continue
      let duration = eventTicks(event)
      let tied = tiedNext(score, part.id, event.id)
      while (tied) { incoming.add(tied.id); duration += eventTicks(tied); tied = tiedNext(score, part.id, tied.id) }
      for (const pitch of event.pitches) result.push({ id: event.id, partId: part.id, measure, tick: absoluteTick, duration, midi: pitchMidi(pitch) + part.transpose, velocity: Math.round(volume * 100) })
    }
  }
  return result.sort((a, b) => a.tick - b.tick)
}

function midiVariable(number: number): number[] {
  const result = [number & 0x7f]
  while ((number >>>= 7)) result.unshift((number & 0x7f) | 0x80)
  return result
}
function midiChunk(type: string, data: number[]): number[] { return [...Array.from(type, character => character.charCodeAt(0)), (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...data] }
/** Standard MIDI format 1 with conductor tempo track and one instrument track per part. */
export function exportMidi(score: NotationScore): Uint8Array {
  validateScore(score)
  const microseconds = Math.round(60_000_000 / score.bpm)
  const endTick = score.parts[0].measures.length * measureTicks(score)
  const conductor = [0, 0xff, 0x51, 3, (microseconds >> 16) & 255, (microseconds >> 8) & 255, microseconds & 255, 0, 0xff, 0x58, 4, score.beats, Math.log2(score.beatType), 24, 8, 0, 0xff, 0x59, 2, score.fifths & 255, 0, ...midiVariable(endTick), 0xff, 0x2f, 0]
  const notes = timeline(score)
  const tracks = score.parts.map((part, index) => {
    const channel = index % 15 >= 9 ? index % 15 + 1 : index % 15
    const name = Array.from(new TextEncoder().encode(part.name))
    const events: { tick: number; off: boolean; data: number[] }[] = []
    for (const note of notes.filter(note => note.partId === part.id)) {
      if (note.midi < 0 || note.midi > 127) continue
      events.push({ tick: note.tick, off: false, data: [0x90 | channel, note.midi, note.velocity] }, { tick: note.tick + note.duration, off: true, data: [0x80 | channel, note.midi, 0] })
    }
    events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off))
    const track = [0, 0xff, 3, ...midiVariable(name.length), ...name, 0, 0xff, 0x21, 1, Math.floor(index / 15), 0, 0xc0 | channel, part.program]
    let previousTick = 0
    for (const event of events) { track.push(...midiVariable(event.tick - previousTick), ...event.data); previousTick = event.tick }
    track.push(...midiVariable(Math.max(0, endTick - previousTick)), 0xff, 0x2f, 0)
    return midiChunk('MTrk', track)
  })
  const count = score.parts.length + 1
  return new Uint8Array([...midiChunk('MThd', [0, 1, (count >>> 8) & 255, count & 255, PPQ >>> 8, PPQ & 255]), ...midiChunk('MTrk', conductor), ...tracks.flat()])
}

export async function readNotationFile(file: File): Promise<NotationScore> {
  if (file.size > 20 * 1024 * 1024) throw new Error('编辑器支持 20 MB 以内的 MusicXML 文件')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const { default: JSZip } = await import('jszip')
    const archive = await JSZip.loadAsync(bytes)
    const container = archive.file('META-INF/container.xml')
    const manifest = container && new DOMParser().parseFromString(await container.async('string'), 'application/xml')
    const rootfile = manifest?.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
    const path = rootfile || Object.keys(archive.files).find(path => !path.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(path))
    const scoreFile = path && archive.file(path)
    if (!scoreFile) throw new Error('MXL 文件中找不到 MusicXML 总谱')
    const xml = await scoreFile.async('string')
    if (xml.length > 20 * 1024 * 1024) throw new Error('MXL 解压后超过 20 MB')
    return parseMusicXml(xml)
  }
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  return parseMusicXml(new TextDecoder(encoding).decode(bytes))
}
