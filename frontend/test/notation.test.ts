import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOMParser } from 'xmldom'
import JSZip from 'jszip'
import { createScore, makePart, INSTRUMENTS, insertEvent, updateEvent, filledVoice, validateScore, eventTicks, measureTicks, PPQ, exportMusicXml, parseMusicXml, exportMidi, timeline, tiedNext, readNotationFile, keyAlter } from '../src/notation/model'
import { xmlTimeline, regularTimeline, detectPdfBars } from '../src/score/timeline'

globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser
const note = (step: 'C'|'D'|'E'|'F'|'G'|'A'|'B' = 'C', duration = 4) => ({ duration: duration as 1|2|4|8|16|32|64, dots: 0, triplet: false, pitches: [{ step, octave: 4, alter: 0 }] })

test('overwrite preserves other voices and fills exact meter with rests', () => {
  const original = createScore()
  const cursor = { partId: original.parts[0].id, measure: 0, voice: 1, tick: 0 }
  const first = insertEvent(original, cursor, note('C', 2))
  const secondVoice = insertEvent(first.score, { ...cursor, voice: 2 }, note('E', 1))
  const overwritten = insertEvent(secondVoice.score, cursor, note('D', 4)).score
  validateScore(overwritten)
  assert.equal(original.parts[0].measures[0].events.length, 0, 'history snapshots remain immutable')
  assert.equal(overwritten.parts[0].measures[0].events.length, 2)
  assert.equal(overwritten.parts[0].measures[0].events.find(event => event.voice === 2)?.pitches[0].step, 'E')
  for (const voice of [1,2]) assert.equal(filledVoice(overwritten,overwritten.parts[0],0,voice).reduce((sum,event) => sum+eventTicks(event),0), measureTicks(overwritten))
  assert.equal(eventTicks({...note(),dots:2}), PPQ*1.75)
  assert.equal(eventTicks({...note(),triplet:true}), PPQ*2/3)
  assert.equal(keyAlter('F',1),1)
  assert.equal(keyAlter('B',-2),-1)
})

test('ties combine playback events and survive MusicXML export/import with multiple voices and escaped text', () => {
  let score = createScore()
  score.title='弦乐 <练习> & 复盘'; score.composer='A & B'
  const cursor={partId:score.parts[0].id,measure:0,voice:1,tick:0}
  const a=insertEvent(score,cursor,note('C',2))
  const b=insertEvent(a.score,a.cursor,note('C',2))
  score=updateEvent(b.score,cursor.partId,a.eventId,{tieNext:true,lyric:'轻 & 柔',dynamic:'p',articulation:'tenuto'})
  score=insertEvent(score,{...cursor,voice:2},note('G',1)).score
  assert.equal(tiedNext(score,cursor.partId,a.eventId)?.id,b.eventId)
  const sounding=timeline(score).filter(event=>event.partId===cursor.partId)
  assert.equal(sounding.length,2)
  assert.equal(sounding[0].duration,4*PPQ)
  const xml=exportMusicXml(score)
  const loaded=parseMusicXml(xml)
  assert.equal(loaded.title,score.title)
  assert.equal(loaded.composer,score.composer)
  assert.equal(loaded.parts[0].measures[0].events.filter(event=>event.pitches.length).length,3)
  assert.equal(loaded.parts[0].measures[0].events[0].lyric,'轻 & 柔')
  assert.deepEqual(timeline(loaded).map(({tick,duration,midi})=>({tick,duration,midi})),sounding.map(({tick,duration,midi})=>({tick,duration,midi})))
  const midi=exportMidi(score)
  assert.equal(new TextDecoder().decode(midi.slice(0,4)),'MThd')
  const view=new DataView(midi.buffer)
  assert.equal(view.getUint16(8),1)
  assert.equal(view.getUint16(10),score.parts.length+1)
  assert.equal(view.getUint16(12),PPQ)
  let position=14, tracks=0
  while(position<midi.length){assert.equal(new TextDecoder().decode(midi.slice(position,position+4)),'MTrk');position+=8+view.getUint32(position+4);tracks++}
  assert.equal(position,midi.length)
  assert.equal(tracks,5)
})

test('triplets export paired tuplet marks and compressed MusicXML imports real notes', async () => {
  let score=createScore(), cursor={partId:score.parts[0].id,measure:0,voice:1,tick:0}
  const normal=insertEvent(score,cursor,note('C')); score=normal.score;cursor=normal.cursor
  for(const step of ['D','E','F'] as const){const inserted=insertEvent(score,cursor,{...note(step,8),triplet:true});score=inserted.score;cursor=inserted.cursor}
  const xml=exportMusicXml(score)
  const parsed=new DOMParser().parseFromString(xml,'text/xml')
  const tuplets=Array.from(parsed.getElementsByTagName('part')[0].getElementsByTagName('tuplet'))
  assert.equal(tuplets.filter(el=>el.getAttribute('type')==='start').length,tuplets.filter(el=>el.getAttribute('type')==='stop').length)
  const zip=new JSZip()
  zip.file('META-INF/container.xml','<container><rootfiles><rootfile full-path="music/main.xml"/></rootfiles></container>')
  zip.file('music/main.xml',xml)
  const bytes=await zip.generateAsync({type:'uint8array'})
  const imported=await readNotationFile(new File([bytes],'exercise.mxl'))
  assert.equal(imported.parts.length,4)
  assert.equal(imported.parts[0].measures[0].events.filter(event=>event.pitches.length).length,4)
  assert.throws(()=>parseMusicXml(xml.replace('<staves>1</staves>','<staves>2</staves>').replace('<clef>','<staves>2</staves><clef>')),/多谱表/)
})

test('timing recognizes 6/8, pickup bars, tempo changes, and multiple voice backup without doubling duration', () => {
  const xml='<score-partwise><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note></measure><measure number="1"><direction><sound tempo="60"/></direction><note><duration>6</duration></note><backup><duration>6</duration></backup><note><duration>6</duration></note></measure></part></score-partwise>'
  const bars=xmlTimeline(xml)
  assert.deepEqual(bars.map(({number,startTime,endTime})=>({number,startTime,endTime})),[{number:1,startTime:0,endTime:.5},{number:2,startTime:.5,endTime:3.5}])
  assert.equal(bars[1].beats,6);assert.equal(bars[1].beatType,8)
  assert.equal(regularTimeline(2,120,6,8)[1].endTime,3)
})

test('editing refuses to flatten tempo changes and large orchestras export distinct MIDI ports', () => {
  const score=createScore()
  const xml=exportMusicXml(score)
  assert.throws(()=>parseMusicXml(xml.replace('<measure number="2">','<measure number="2"><direction><sound tempo="75"/></direction>')),/速度变化/)
  score.parts=Array.from({length:32},(_,index)=>makePart(INSTRUMENTS[index%INSTRUMENTS.length],4))
  const exported=exportMusicXml(score)
  const parsed=new DOMParser().parseFromString(exported,'text/xml')
  const channels=Array.from(parsed.getElementsByTagName('midi-channel')).map(element=>Number(element.textContent))
  assert.equal(channels.includes(10),false,'melodic parts must not use the percussion channel')
  assert.equal(parsed.getElementsByTagName('midi-device')[15].getAttribute('port'),'2')
  const midi=exportMidi(score),view=new DataView(midi.buffer)
  let position=14,track=0
  while(position<midi.length){const length=view.getUint32(position+4);if(track){const body=Array.from(midi.slice(position+8,position+8+length));const marker=body.findIndex((byte,index)=>byte===0xff&&body[index+1]===0x21);assert.equal(body[marker+3],Math.floor((track-1)/15))};position+=8+length;track++}
  assert.equal(track,33)
})

test('PDF candidate detection finds staff bars while a blank scan has no fabricated measures', () => {
  const width=900,height=200,data=new Uint8ClampedArray(width*height*4).fill(255)
  const image={width,height,data} as ImageData
  assert.deepEqual(detectPdfBars(image,1,1),[])
  const draw=(x:number,y:number)=>{const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0}
  for(const y of [80,88,96,104,112])for(let x=80;x<=820;x++)draw(x,y)
  for(const x of [80,300,580,820])for(let y=80;y<=112;y++)draw(x,y)
  const regions=detectPdfBars(image,1,4)
  assert.equal(regions.length,3)
  assert.deepEqual(regions.map(region=>region.number),[4,5,6])
})
