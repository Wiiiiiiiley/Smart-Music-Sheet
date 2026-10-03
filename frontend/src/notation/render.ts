// The explicit entry point uses VexFlow 4's own types; OSMD ships legacy ambient types for "vexflow".
import { Accidental, Annotation, Articulation, Barline, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveConnector, StaveNote, StaveTie, Tuplet, Voice } from 'vexflow/bravura'
import { eventTicks, filledVoice, keyAlter, measureTicks, PPQ, tiedNext } from './model'
import type { EditCursor, NotationEvent, NotationScore } from './model'

export interface RenderResult { width: number; height: number }
const VOICE_COLORS = ['#172033', '#7c3aed', '#0891b2', '#c2410c']
const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
const svgElement = (name: string) => document.createElementNS('http://www.w3.org/2000/svg', name)

/** VexFlow owns this host; React owns the surrounding editor and controls. */
export function renderNotation(host: HTMLDivElement, score: NotationScore, selection: string | null, cursor: EditCursor, playbackMeasure = -1, onlyPartId?: string): RenderResult {
  host.replaceChildren()
  const parts = onlyPartId ? score.parts.filter(part => part.id === onlyPartId) : score.parts
  const count = score.parts[0].measures.length
  const columns = 2
  const labelWidth = 138
  const measureWidth = 480
  const width = labelWidth + measureWidth * columns + 35
  const staffGap = 125
  const systemGap = 64
  const titleSpace = 110
  const systemHeight = parts.length * staffGap + systemGap
  const height = titleSpace + Math.ceil(count / columns) * systemHeight + 20
  const renderer = new Renderer(host, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const context = renderer.getContext()
  const svg = host.querySelector('svg')!
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${score.title}，${parts.length} 个乐器声部，${count} 小节，可点击音符编辑`)
  context.setFont('Arial', 22, 'bold').fillText(score.title || '无标题总谱', labelWidth, 42)
  context.setFont('Arial', 13, '').fillText(score.composer ? `作曲：${score.composer}` : '', labelWidth, 68)
  context.fillText(`♩ = ${score.bpm}    ${score.beats}/${score.beatType}    ${score.fifths ? `${Math.abs(score.fifths)} ${score.fifths > 0 ? '升号' : '降号'}` : 'C 大调 / a 小调'}${onlyPartId ? ' · 分谱' : ' · 移调总谱'}`, labelWidth, 88)

  const rendered = new Map<string, StaveNote>()
  const eventMap = new Map<string, NotationEvent>()
  const overlayRects: SVGRectElement[] = []
  const tupletDraws: Tuplet[] = []
  const beamDraws: Beam[] = []
  for (let measureIndex = 0; measureIndex < count; measureIndex++) {
    const system = Math.floor(measureIndex / columns)
    const column = measureIndex % columns
    const x = labelWidth + column * measureWidth
    const top = titleSpace + system * systemHeight
    const allVoices: Voice[] = []
    const partVoices: { stave: Stave; voices: Voice[] }[] = []
    const formatter = new Formatter()
    let firstStave: Stave | undefined
    let lastStave: Stave | undefined
    for (const [partIndex, part] of parts.entries()) {
      const y = top + partIndex * staffGap
      if (column === 0) {
        context.setFont('Arial', 12, '').fillText(part.abbreviation || part.name, 24, y + 57)
      }
      const background = svgElement('rect') as SVGRectElement
      background.setAttribute('x', String(x)); background.setAttribute('y', String(y + 5))
      background.setAttribute('width', String(measureWidth)); background.setAttribute('height', String(staffGap))
      background.setAttribute('fill', measureIndex === playbackMeasure ? '#dcfce7' : cursor.partId === part.id && cursor.measure === measureIndex ? '#eff6ff' : '#fff')
      svg.appendChild(background)
      const stave = new Stave(x, y + 5, measureWidth)
      if (column === 0) { stave.addClef(part.clef); stave.addKeySignature(KEY_NAMES[score.fifths + 7]); stave.addTimeSignature(`${score.beats}/${score.beatType}`) }
      if (measureIndex === count - 1) stave.setEndBarType(Barline.type.END)
      stave.setContext(context).draw()
      firstStave ||= stave; lastStave = stave
      const available = new Set([1, cursor.partId === part.id && cursor.measure === measureIndex ? cursor.voice : 1, ...part.measures[measureIndex].events.map(event => event.voice)])
      const voices: Voice[] = []
      for (const voiceNumber of Array.from(available).sort()) {
        const events = filledVoice(score, part, measureIndex, voiceNumber)
        const notes = events.map(event => {
          const note = new StaveNote({ keys: event.pitches.length ? event.pitches.map(pitch => `${pitch.step.toLowerCase()}${pitch.alter === -2 ? 'bb' : pitch.alter === -1 ? 'b' : pitch.alter === 2 ? '##' : pitch.alter === 1 ? '#' : ''}/${pitch.octave}`) : [part.clef === 'bass' ? 'd/3' : part.clef === 'alto' ? 'c/4' : 'b/4'], duration: `${event.duration === 1 ? 'w' : event.duration === 2 ? 'h' : event.duration === 4 ? 'q' : event.duration}${!event.pitches.length ? 'r' : ''}`, clef: part.clef, auto_stem: voices.length === 0 && available.size === 1, stem_direction: voiceNumber % 2 ? 1 : -1 })
          note.setIntrinsicTicks(eventTicks(event) / PPQ * 4096)
          note.setStave(stave)
          note.setStyle({ fillStyle: event.id === selection ? '#2563eb' : VOICE_COLORS[voiceNumber - 1], strokeStyle: event.id === selection ? '#2563eb' : VOICE_COLORS[voiceNumber - 1] })
          for (let dot = 0; dot < event.dots; dot++) Dot.buildAndAttach([note], { all: true })
          for (const [pitchIndex, pitch] of event.pitches.entries()) {
            const previousPitches = events.filter(item => item.tick < event.tick).flatMap(item => item.pitches).filter(item => item.step === pitch.step && item.octave === pitch.octave)
            const previous = previousPitches[previousPitches.length - 1]
            if (pitch.alter !== (previous?.alter ?? keyAlter(pitch.step, score.fifths))) note.addModifier(new Accidental(pitch.alter === -2 ? 'bb' : pitch.alter === -1 ? 'b' : pitch.alter === 2 ? '##' : pitch.alter === 1 ? '#' : 'n'), pitchIndex)
          }
          if (event.dynamic) note.addModifier(new Annotation(event.dynamic).setFont('Times New Roman', 14, 'italic').setVerticalJustification(Annotation.VerticalJustify.BOTTOM))
          if (event.lyric) note.addModifier(new Annotation(event.lyric).setFont('Arial', 11, '').setVerticalJustification(Annotation.VerticalJustify.BOTTOM))
          if (event.articulation) note.addModifier(new Articulation(({ staccato: 'a.', accent: 'a>', tenuto: 'a-' })[event.articulation]).setPosition(3))
          rendered.set(event.id, note); eventMap.set(event.id, event)
          return note
        })
        for (let index = 0; index < events.length;) {
          if (!events[index].triplet) { index++; continue }
          const group: StaveNote[] = []
          const duration = events[index].duration
          while (index < events.length && events[index].triplet && events[index].duration === duration && group.length < 3) group.push(notes[index++])
          const tuplet = new Tuplet(group, { num_notes: 3, notes_occupied: 2, bracketed: true, location: voiceNumber % 2 ? 1 : -1 })
          // The model already supplied exact triplet ticks; cancel Tuplet's additional multiplier.
          for (const note of group) note.applyTickMultiplier(3, 2)
          tupletDraws.push(tuplet)
        }
        beamDraws.push(...Beam.generateBeams(notes, { groups: [new Fraction(score.beatType === 8 && score.beats % 3 === 0 ? 3 : 1, score.beatType)], stem_direction: voiceNumber % 2 ? 1 : -1 }))
        const voice = new Voice({ num_beats: score.beats, beat_value: score.beatType }).setMode(Voice.Mode.SOFT).addTickables(notes)
        voices.push(voice); allVoices.push(voice)
      }
      formatter.joinVoices(voices)
      partVoices.push({ stave, voices })
      const area = svgElement('rect') as SVGRectElement
      area.setAttribute('x', String(stave.getNoteStartX())); area.setAttribute('y', String(y + 17))
      area.setAttribute('width', String(stave.getNoteEndX() - stave.getNoteStartX())); area.setAttribute('height', '83')
      area.setAttribute('fill', 'transparent'); area.setAttribute('data-part-id', part.id); area.setAttribute('data-measure', String(measureIndex))
      area.setAttribute('data-start-x', String(stave.getNoteStartX())); area.setAttribute('data-end-x', String(stave.getNoteEndX()))
      area.setAttribute('aria-label', `${part.name} 第 ${measureIndex + 1} 小节`)
      overlayRects.push(area)
    }
    if (firstStave && lastStave && parts.length > 1) new StaveConnector(firstStave, lastStave).setType(column === 0 ? 'bracket' : 'singleLeft').setContext(context).draw()
    const startX = Math.max(...partVoices.map(({ stave }) => stave.getNoteStartX()))
    for (const { stave } of partVoices) stave.setNoteStartX(startX)
    if (firstStave) formatter.formatToStave(allVoices, firstStave, { align_rests: true, context })
    for (const { stave, voices } of partVoices) for (const voice of voices) voice.draw(context, stave)
    context.setFont('Arial', 10, '').fillText(String(measureIndex + 1), x + 4, top + 7)
    if (cursor.measure === measureIndex && parts.some(part => part.id === cursor.partId)) {
      const partIndex = parts.findIndex(part => part.id === cursor.partId)
      const existing = parts[partIndex].measures[measureIndex].events.find(event => event.tick === cursor.tick && event.voice === cursor.voice)
      const note = existing && rendered.get(existing.id)
      const cursorX = note ? note.getAbsoluteX() : startX + (measureWidth - (startX - x) - 18) * cursor.tick / measureTicks(score)
      const line = svgElement('line')
      line.setAttribute('x1', String(cursorX)); line.setAttribute('x2', String(cursorX)); line.setAttribute('y1', String(top + partIndex * staffGap + 24)); line.setAttribute('y2', String(top + partIndex * staffGap + 90)); line.setAttribute('stroke', '#2563eb'); line.setAttribute('stroke-width', '2'); line.setAttribute('pointer-events', 'none')
      svg.appendChild(line)
    }
  }
  for (const beam of beamDraws) beam.setContext(context).draw()
  for (const tuplet of tupletDraws) tuplet.setContext(context).draw()
  for (const part of parts) for (const measure of part.measures) for (const event of measure.events) {
    const next = tiedNext(score, part.id, event.id)
    if (!next) continue
    const firstNote = rendered.get(event.id), lastNote = rendered.get(next.id)
    if (!firstNote || !lastNote) continue
    const sameSystem = Math.floor(part.measures.findIndex(item => item.events.some(note => note.id === event.id)) / columns) === Math.floor(part.measures.findIndex(item => item.events.some(note => note.id === next.id)) / columns)
    const indices = event.pitches.map((_, index) => index)
    if (sameSystem) new StaveTie({ first_note: firstNote, last_note: lastNote, first_indices: indices, last_indices: indices }).setContext(context).draw()
    else {
      new StaveTie({ first_note: firstNote, first_indices: indices, last_indices: indices }).setContext(context).draw()
      new StaveTie({ last_note: lastNote, first_indices: indices, last_indices: indices }).setContext(context).draw()
    }
  }
  for (const area of overlayRects) svg.appendChild(area)
  for (const [eventId, note] of rendered) {
    const event = eventMap.get(eventId)!
    const part = parts.find(item => item.measures.some(measure => measure.events.some(item => item.id === eventId)))
    const bounds = note.getBoundingBox()
    const rect = svgElement('rect')
    rect.setAttribute('x', String(bounds.x - 8)); rect.setAttribute('y', String(bounds.y - 12)); rect.setAttribute('width', String(Math.max(bounds.w + 16, 24))); rect.setAttribute('height', String(Math.max(bounds.h + 24, 44)))
    rect.setAttribute('fill', 'transparent'); rect.setAttribute('data-event-id', eventId)
    if (part) rect.setAttribute('data-part-id', part.id)
    rect.setAttribute('aria-label', `${event.pitches.length ? event.pitches.map(pitch => `${pitch.step}${pitch.alter ? pitch.alter > 0 ? '升' : '降' : ''}${pitch.octave}`).join('、') : '休止符'}，声音 ${event.voice}`)
    rect.style.cursor = 'pointer'
    svg.appendChild(rect)
  }
  return { width, height }
}
