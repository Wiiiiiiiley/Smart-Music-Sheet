import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { publishEnsemble } from '../realtime';
import { canSeeMark, canReceiveTarget, scoreJSON, FeatureError, validateTimings, validateTracks, validateRegions } from '../features';

const router = Router();
const handle = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
  try { await fn(req, res); } catch (failure) {
    res.status(failure instanceof FeatureError ? failure.status : 500).json({ error: failure instanceof FeatureError ? failure.message : '乐谱操作失败，请重试' });
  }
};
async function scoreAndViewer(id: string, memberId: unknown, conductorOnly = false) {
  const score = await prisma.score.findUnique({ where: { id } });
  if (!score) throw new FeatureError('乐谱不存在', 404);
  const viewer = typeof memberId === 'string' && memberId ? await prisma.member.findFirst({ where: { id: memberId, ensembleId: score.ensembleId } }) : null;
  if ((memberId !== undefined && !viewer) || (conductorOnly && viewer?.role !== 'CONDUCTOR')) throw new FeatureError('成员无权访问此乐谱', 403);
  return { score, viewer };
}
router.get('/', handle(async (req, res) => {
  const ensembleId = typeof req.query.ensembleId === 'string' ? req.query.ensembleId : undefined;
  const scores = await prisma.score.findMany({ where: ensembleId ? { ensembleId } : {}, orderBy: { createdAt: 'desc' } });
  res.json(scores.map(scoreJSON));
}));
router.get('/:id', handle(async (req, res) => {
  const { score, viewer } = await scoreAndViewer(req.params.id, req.query.memberId);
  const [marks, measures] = await Promise.all([
    prisma.mark.findMany({ where: { scoreId: score.id }, include: { creator: { select: { name: true, role: true, section: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.measure.findMany({ where: { scoreId: score.id }, include: { cues: true }, orderBy: { number: 'asc' } }),
  ]);
  res.json({ ...scoreJSON(score), marks: marks.filter(mark => canSeeMark(mark, viewer)), measures: measures.map(measure => ({ ...measure, cues: measure.cues.filter(cue => canReceiveTarget(cue, viewer)) })) });
}));
router.post('/', handle(async (req, res) => {
  const { title, composer, fileUrl, fileType, audioUrl, ensembleId } = req.body;
  if (typeof title !== 'string' || !title.trim() || typeof fileUrl !== 'string' || !fileUrl || !['pdf', 'musicxml'].includes(fileType) || typeof ensembleId !== 'string') throw new FeatureError('乐谱信息无效');
  if (!await prisma.ensemble.findUnique({ where: { id: ensembleId } })) throw new FeatureError('乐团不存在', 404);
  const score = await prisma.score.create({ data: { title: title.trim(), composer, fileUrl, fileType, audioUrl, ensembleId } });
  res.status(201).json({ ...scoreJSON(score), measures: [], marks: [] });
}));
router.put('/:id', handle(async (req, res) => {
  await scoreAndViewer(req.params.id, undefined);
  const { title, composer, audioUrl } = req.body;
  const score = await prisma.score.update({ where: { id: req.params.id }, data: { title, composer, audioUrl } });
  res.json(scoreJSON(score));
}));
router.delete('/:id', handle(async (req, res) => {
  await scoreAndViewer(req.params.id, undefined);
  await prisma.score.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}));
router.get('/:id/marks', handle(async (req, res) => {
  const { score, viewer } = await scoreAndViewer(req.params.id, req.query.memberId);
  const marks = await prisma.mark.findMany({ where: { scoreId: score.id }, include: { creator: { select: { name: true, role: true, section: true } } }, orderBy: { createdAt: 'asc' } });
  res.json(marks.filter(mark => canSeeMark(mark, viewer)));
}));
router.put('/:id/measures', handle(async (req, res) => {
  const { score } = await scoreAndViewer(req.params.id, req.body.memberId, true);
  const incoming = validateTimings(req.body.measures);
  const measures = await prisma.$transaction(async tx => {
    const previous = await tx.measure.findMany({ where: { scoreId: score.id } });
    const retainedIds: string[] = [];
    for (const timing of incoming) {
      const existing = previous.find(measure => measure.number === timing.number);
      const startTime = timing.startTime === undefined ? existing?.startTime : timing.startTime;
      const endTime = timing.endTime === undefined ? existing?.endTime : timing.endTime;
      validateTimings([{ ...timing, startTime, endTime }]);
      const saved = existing
        ? await tx.measure.update({ where: { id: existing.id }, data: { startTime, endTime } })
        : await tx.measure.create({ data: { scoreId: score.id, number: timing.number, startTime, endTime } });
      retainedIds.push(saved.id);
    }
    await tx.measure.deleteMany({ where: { scoreId: score.id, ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}) } });
    return tx.measure.findMany({ where: { scoreId: score.id }, include: { cues: true }, orderBy: { number: 'asc' } });
  });
  res.json(measures);
}));
router.put('/:id/layout', handle(async (req, res) => {
  const { score } = await scoreAndViewer(req.params.id, req.body.memberId, true);
  const regions = validateRegions(req.body.regions);
  await prisma.score.update({ where: { id: score.id }, data: { measureRegions: JSON.stringify(regions) } });
  publishEnsemble(score.ensembleId, 'score-layout-updated', { scoreId: score.id, regions });
  res.json(regions);
}));
router.get('/:id/tracks', handle(async (req, res) => {
  const { score } = await scoreAndViewer(req.params.id, req.query.memberId);
  res.json(scoreJSON(score).audioTracks);
}));
router.put('/:id/tracks', handle(async (req, res) => {
  const { score } = await scoreAndViewer(req.params.id, req.body.memberId, true);
  const tracks = validateTracks(req.body.tracks);
  await prisma.score.update({ where: { id: score.id }, data: { audioTracks: JSON.stringify(tracks) } });
  publishEnsemble(score.ensembleId, 'score-tracks-updated', { scoreId: score.id, tracks });
  res.json(tracks);
}));
router.post('/:id/measures/:measureId/cues', handle(async (req, res) => {
  const measure = await prisma.measure.findFirst({ where: { id: req.params.measureId, scoreId: req.params.id } });
  if (!measure) throw new FeatureError('小节不存在', 404);
  const { type, targetSection, audioUrl, bpm, timeSignature } = req.body;
  if (!['CLICK', 'COUNT_IN', 'METRONOME', 'DEMO_AUDIO'].includes(type)) throw new FeatureError('提示类型无效');
  res.status(201).json(await prisma.cue.create({ data: { type, measureId: measure.id, targetSection, audioUrl, bpm, timeSignature } }));
}));
router.put('/:id/measures/:measureId/timing', handle(async (req, res) => {
  const measure = await prisma.measure.findFirst({ where: { id: req.params.measureId, scoreId: req.params.id } });
  if (!measure) throw new FeatureError('小节不存在', 404);
  validateTimings([{ number: measure.number, ...req.body }]);
  res.json(await prisma.measure.update({ where: { id: measure.id }, data: { startTime: req.body.startTime, endTime: req.body.endTime } }));
}));
export default router;
