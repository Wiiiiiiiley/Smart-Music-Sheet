import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { DOMParser } from 'xmldom'
import { addMeasure, createScore, deleteEvent, eventTicks, exportMidi, exportMusicXml, filledVoice, INSTRUMENTS, insertEvent, keyAlter, makePart, measureTicks, parseMusicXml, pitchAtCursor, removeMeasure, timeline, tiedNext, updateEvent, validateScore } from '../src/notation/model.ts'

const parser = new DOMParser()
const quarter = { duration: 4, dots: 0, triplet: false, pitches: [{ step: 'C', octave: 4, alter: 0 }] }
const score = createScore()
assert.equal(score.parts.length, 4)
assert.equal(score.parts[2].clef, 'alto')
assert.equal(score.parts[3].clef, 'bass')
assert.equal(measureTicks(score), 3840)
assert.equal(eventTicks({ duration: 8, dots: 1, triplet: false }), 720)
assert.equal(eventTicks({ duration: 8, dots: 0, triplet: true }), 320)

let cursor = { partId: score.parts[0].id, measure: 0, voice: 1, tick: 0 }
let result = insertEvent(score, cursor, quarter)
assert.equal(result.cursor.tick, 960)
assert.equal(result.score.parts[0].measures[0].events.length, 1)
assert.equal(score.parts[0].measures[0].events.length, 0, 'editing is immutable')
let current = result.score
const firstId = result.eventId
result = insertEvent(current, result.cursor, { ...quarter, pitches: [{ step: 'D', octave: 4, alter: 0 }] })
current = result.score
const secondId = result.eventId
result = insertEvent(current, { ...cursor, voice: 2, tick: 0 }, { ...quarter, duration: 2, pitches: [{ step: 'G', octave: 3, alter: 0 }] })
current = result.score
assert.equal(current.parts[0].measures[0].events.length, 3, 'voices remain independent')
current = updateEvent(current, cursor.partId, firstId, { pitches: [...quarter.pitches, { step: 'E', octave: 4, alter: 0 }, { step: 'G', octave: 4, alter: 0 }] })
assert.equal(timeline(current).filter(note => note.tick === 0).length, 4)
const exported = exportMusicXml(current)
assert.ok(exported.includes('<backup><duration>3840</duration></backup>'))
const imported = parseMusicXml(exported, parser)
assert.deepEqual(timeline(imported).map(({ tick, duration, midi }) => ({ tick, duration, midi })), timeline(current).map(({ tick, duration, midi }) => ({ tick, duration, midi })), 'MusicXML preserves multi-voice chords and timing')

current = updateEvent(current, cursor.partId, firstId, { duration: 2 })
assert.ok(!current.parts[0].measures[0].events.some(note => note.id === secondId), 'duration editing overwrites overlapping notes in its own voice')
assert.ok(current.parts[0].measures[0].events.some(note => note.voice === 2), 'overwrite does not remove another voice')
assert.throws(() => updateEvent(current, cursor.partId, firstId, { duration: 1, dots: 1 }), /小节/)
assert.equal(filledVoice(current, current.parts[0], 0, 1).reduce((sum, event) => sum + eventTicks(event), 0), measureTicks(current))

let tripletScore = createScore()
let tripletCursor = { partId: tripletScore.parts[0].id, measure: 0, voice: 1, tick: 0 }
for (const step of ['C', 'D', 'E']) {
  const triplet = insertEvent(tripletScore, tripletCursor, { ...quarter, duration: 8, triplet: true, pitches: [{ step, octave: 5, alter: 0 }] })
  tripletScore = triplet.score; tripletCursor = triplet.cursor
}
assert.equal(tripletCursor.tick, 960)
const tripletRoundTrip = parseMusicXml(exportMusicXml(tripletScore), parser)
assert.deepEqual(timeline(tripletRoundTrip).map(note => [note.tick, note.duration, note.midi]), timeline(tripletScore).map(note => [note.tick, note.duration, note.midi]))

let tiedScore = createScore()
const endCursor = { partId: tiedScore.parts[0].id, measure: 0, voice: 1, tick: 2880 }
const first = insertEvent(tiedScore, endCursor, quarter)
const second = insertEvent(first.score, first.cursor, quarter)
tiedScore = updateEvent(second.score, endCursor.partId, first.eventId, { tieNext: true })
assert.equal(tiedNext(tiedScore, endCursor.partId, first.eventId)?.id, second.eventId)
assert.equal(timeline(tiedScore).length, 1)
assert.equal(timeline(tiedScore)[0].duration, 1920, 'tied notes sustain through the barline')
assert.equal(timeline(parseMusicXml(exportMusicXml(tiedScore), parser))[0].duration, 1920)
tiedScore = deleteEvent(tiedScore, second.eventId)
assert.equal(tiedNext(tiedScore, endCursor.partId, first.eventId), undefined, 'deletion removes an invalid tie semantically')

assert.equal(keyAlter('F', 1), 1)
assert.equal(keyAlter('B', -1), -1)
assert.equal(pitchAtCursor({ ...score, fifths: 1 }, cursor, 'F', 4, null).alter, 1)
let keyed = insertEvent({ ...score, fifths: 1 }, cursor, { ...quarter, pitches: [{ step: 'F', octave: 4, alter: 0 }] }).score
assert.equal(pitchAtCursor(keyed, { ...cursor, tick: 960 }, 'F', 4, null).alter, 0, 'accidental lasts within the measure')
assert.equal(pitchAtCursor(keyed, { ...cursor, measure: 1, tick: 0 }, 'F', 4, null).alter, 1, 'accidental resets at next measure')

const clarinet = makePart(INSTRUMENTS.find(instrument => instrument.name === 'B♭ 单簧管'), 4)
let transposing = { ...createScore(), parts: [clarinet] }
transposing = insertEvent(transposing, { partId: clarinet.id, voice: 1, measure: 0, tick: 0 }, quarter).score
assert.equal(timeline(transposing)[0].midi, 58, 'written C4 sounds as Bb3 on clarinet')
assert.equal(timeline(parseMusicXml(exportMusicXml(transposing), parser))[0].midi, 58)

const midi = exportMidi(transposing)
assert.equal(new TextDecoder().decode(midi.subarray(0, 4)), 'MThd')
assert.equal(midi[9], 1, 'MIDI format 1')
assert.equal(midi[11], 2, 'tempo track plus instrument track')
assert.equal(midi[12] * 256 + midi[13], 960)
assert.ok(Array.from(midi).some((value, index, bytes) => value === 0x90 && bytes[index + 1] === 58), 'MIDI contains sounding transposed pitch')
assert.equal(removeMeasure(addMeasure(score, 1), 2).parts[0].measures.length, 4)
let oneMeasure = { ...createScore(), parts: score.parts.map(part => ({ ...part, measures: [{ events: [] }] })) }
assert.throws(() => removeMeasure(oneMeasure, 0), /至少/)
assert.throws(() => validateScore({ ...score, bpm: 0 }), /速度/)
assert.throws(() => parseMusicXml('<invalid/>', parser), /有效/)
const fixture = await fs.readFile(new URL('../../scripts/fixtures/two-page.musicxml', import.meta.url), 'utf8')
if (fixture) { const fixtureScore = parseMusicXml(fixture, parser); assert.ok(timeline(fixtureScore).length > 0) }
const changedMeter = exportMusicXml(score).replace('<measure number="2">', '<measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes>')
assert.throws(() => parseMusicXml(changedMeter, parser), /变拍号/)
console.log('Notation model: chords, four voices, overwrite, tuplets, barline ties, transpose, MusicXML round trips, MIDI and validation passed.')
