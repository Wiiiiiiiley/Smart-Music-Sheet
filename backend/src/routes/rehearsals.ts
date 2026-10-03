import { Router } from 'express';
import { prisma } from '../db';
import { getEnsembleState } from '../realtime';
import { canSeeEvent, text } from '../features';

const router = Router();

// 获取排练记录
router.get('/', async (req, res) => {
  try {
    const { ensembleId } = req.query;
    const rehearsals = await prisma.rehearsal.findMany({
      where: ensembleId ? { ensembleId: ensembleId as string } : undefined,
      include: {
        ensemble: true,
        _count: {
          select: { events: true }
        }
      },
      orderBy: { startedAt: 'desc' }
    });
    res.json(rehearsals);
  } catch (error) {
    console.error('获取排练记录失败:', error);
    res.status(500).json({ error: '获取排练记录失败' });
  }
});

// 获取排练详情
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rehearsal = await prisma.rehearsal.findUnique({
      where: { id },
      include: {
        events: {
          orderBy: { timestamp: 'asc' }
        },
        ensemble: true
      }
    });
    
    if (!rehearsal) {
      return res.status(404).json({ error: '排练记录不存在' });
    }
    
    const memberId = typeof req.query.memberId === 'string' ? req.query.memberId : undefined;
    const viewer = memberId ? await prisma.member.findFirst({ where: { id: memberId, ensembleId: rehearsal.ensembleId } }) : null;
    if (memberId && !viewer) return res.status(403).json({ error: '成员无权访问此排练' });
    res.json({ ...rehearsal, events: rehearsal.events.filter(event => canSeeEvent(event, viewer)) });
  } catch (error) {
    console.error('获取排练详情失败:', error);
    res.status(500).json({ error: '获取排练详情失败' });
  }
});

// 开始排练
router.post('/start', async (req, res) => {
  try {
    const { ensembleId, scoreId } = req.body;
    
    if (typeof ensembleId !== 'string' || typeof scoreId !== 'string') return res.status(400).json({ error: '请先选择乐团和乐谱' });
    const score = await prisma.score.findFirst({ where: { id: scoreId, ensembleId } });
    if (!score) return res.status(404).json({ error: '乐谱不存在' });
    const rehearsal = await prisma.rehearsal.create({
      data: {
        ensembleId,
        scoreId
      }
    });
    
    // 记录开始事件
    await prisma.rehearsalEvent.create({
      data: {
        rehearsalId: rehearsal.id,
        type: 'REHEARSAL_STARTED',
        data: JSON.stringify({ scoreId })
      }
    });
    
    Object.assign(getEnsembleState(ensembleId), { scoreId, rehearsalId: rehearsal.id, isRehearsing: true, page: 1 });
    res.status(201).json(rehearsal);
  } catch (error) {
    console.error('开始排练失败:', error);
    res.status(500).json({ error: '开始排练失败' });
  }
});

// 结束排练
router.post('/:id/end', async (req, res) => {
  try {
    const { id } = req.params;
    const { recordingUrl } = req.body;
    
    const existing = await prisma.rehearsal.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '排练记录不存在' });
    const rehearsal = await prisma.rehearsal.update({
      where: { id },
      data: {
        endedAt: new Date(),
        recordingUrl
      }
    });
    
    // 记录结束事件
    await prisma.rehearsalEvent.create({
      data: {
        rehearsalId: id,
        type: 'REHEARSAL_ENDED',
        data: '{}'
      }
    });
    
    Object.assign(getEnsembleState(rehearsal.ensembleId), { isRehearsing: false, rehearsalId: undefined });
    res.json(rehearsal);
  } catch (error) {
    console.error('结束排练失败:', error);
    res.status(500).json({ error: '结束排练失败' });
  }
});

// Recording may finish uploading after the rehearsal ends.
router.put('/:id/recording', async (req, res) => {
  try {
    const rehearsal = await prisma.rehearsal.findUnique({ where: { id: req.params.id } });
    if (!rehearsal) return res.status(404).json({ error: '排练记录不存在' });
    const member = typeof req.body.memberId === 'string' ? await prisma.member.findFirst({ where: { id: req.body.memberId, ensembleId: rehearsal.ensembleId, role: 'CONDUCTOR' } }) : null;
    if (!member) return res.status(403).json({ error: '只有指挥可以保存录音' });
    const recordingUrl = text(req.body.recordingUrl, 4000);
    if (!recordingUrl || !/^(https?:\/\/|\/)/i.test(recordingUrl)) return res.status(400).json({ error: '录音文件地址无效' });
    res.json(await prisma.rehearsal.update({ where: { id: rehearsal.id }, data: { recordingUrl } }));
  } catch { res.status(500).json({ error: '保存录音失败' }); }
});

// 记录排练事件
router.post('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, data } = req.body;
    
    const event = await prisma.rehearsalEvent.create({
      data: {
        rehearsalId: id,
        type,
        data: JSON.stringify(data)
      }
    });
    
    res.status(201).json(event);
  } catch (error) {
    console.error('记录事件失败:', error);
    res.status(500).json({ error: '记录事件失败' });
  }
});

// 获取排练统计
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    
    const events = await prisma.rehearsalEvent.groupBy({
      by: ['type'],
      where: { rehearsalId: id },
      _count: {
        type: true
      }
    });
    
    const rehearsal = await prisma.rehearsal.findUnique({
      where: { id },
      select: { startedAt: true, endedAt: true }
    });
    
    if (!rehearsal) return res.status(404).json({ error: '排练记录不存在' });
    const duration = rehearsal.endedAt 
      ? new Date(rehearsal.endedAt).getTime() - new Date(rehearsal.startedAt).getTime()
      : Date.now() - new Date(rehearsal.startedAt).getTime();
    
    res.json({
      duration: Math.floor(duration / 1000), // 秒
      eventCounts: events.reduce((acc: any, e: any) => ({
        ...acc,
        [e.type]: e._count.type
      }), {})
    });
  } catch (error) {
    console.error('获取统计失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});

export default router;
