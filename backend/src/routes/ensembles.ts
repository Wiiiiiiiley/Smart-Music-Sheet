import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { canReceiveTarget, parseJSON, scoreJSON } from '../features';

const router = Router();
router.get('/', async (_req, res) => {
  try {
    res.json(await prisma.ensemble.findMany({ include: { _count: { select: { members: true, scores: true } } }, orderBy: { createdAt: 'desc' } }));
  } catch { res.status(500).json({ error: '获取乐团列表失败' }); }
});
router.get('/:id', async (req, res) => {
  try {
    const ensemble = await prisma.ensemble.findUnique({ where: { id: req.params.id }, include: { members: { orderBy: [{ role: 'asc' }, { section: 'asc' }] }, scores: { orderBy: { createdAt: 'desc' } } } });
    if (!ensemble) return res.status(404).json({ error: '乐团不存在' });
    res.json({ ...ensemble, scores: ensemble.scores.map(scoreJSON) });
  } catch { res.status(500).json({ error: '获取乐团详情失败' }); }
});
router.post('/', async (req, res) => {
  const { name, conductorId, conductorName } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof conductorId !== 'string' || !conductorId.trim()) return res.status(400).json({ error: '请填写乐团名称和指挥信息' });
  try {
    // The conductor is also a Member, so marks can reference a real creator.
    const ensemble = await prisma.$transaction(async tx => {
      const occupied = await tx.member.findUnique({ where: { id: conductorId } });
      const memberId = occupied ? randomUUID() : conductorId;
      return tx.ensemble.create({ data: { name: name.trim(), conductorId: memberId, members: { create: { id: memberId, name: typeof conductorName === 'string' && conductorName.trim() ? conductorName.trim() : '指挥', role: 'CONDUCTOR' } } }, include: { members: true, scores: true } });
    });
    res.status(201).json(ensemble);
  } catch { res.status(500).json({ error: '创建乐团失败' }); }
});
router.post('/:id/members', async (req, res) => {
  const { name, role = 'PLAYER', instrument, section, id } = req.body;
  if (typeof name !== 'string' || !name.trim() || !['PLAYER', 'CONDUCTOR'].includes(role)) return res.status(400).json({ error: '成员信息无效' });
  try {
    const ensemble = await prisma.ensemble.findUnique({ where: { id: req.params.id } });
    if (!ensemble) return res.status(404).json({ error: '乐团不存在' });
    const existing = typeof id === 'string' ? await prisma.member.findUnique({ where: { id } }) : null;
    if (existing?.ensembleId === ensemble.id) return res.json(existing);
    if (role === 'CONDUCTOR') return res.status(400).json({ error: '乐团已有指挥' });
    const member = await prisma.member.create({ data: { id: typeof id === 'string' && id && !existing ? id : undefined, name: name.trim(), role, instrument: typeof instrument === 'string' ? instrument : null, section: typeof section === 'string' && section ? section : null, ensembleId: ensemble.id } });
    res.status(201).json(member);
  } catch { res.status(500).json({ error: '添加成员失败' }); }
});
router.put('/:id/members/:memberId', async (req, res) => {
  try {
    const member = await prisma.member.findFirst({ where: { id: req.params.memberId, ensembleId: req.params.id } });
    if (!member) return res.status(404).json({ error: '成员不存在' });
    const { name, instrument, section } = req.body;
    res.json(await prisma.member.update({ where: { id: member.id }, data: { name, instrument, section } }));
  } catch { res.status(400).json({ error: '更新成员失败' }); }
});
router.delete('/:id/members/:memberId', async (req, res) => {
  try {
    const member = await prisma.member.findFirst({ where: { id: req.params.memberId, ensembleId: req.params.id } });
    if (!member) return res.status(404).json({ error: '成员不存在' });
    if (member.role === 'CONDUCTOR') return res.status(400).json({ error: '不能删除乐团指挥' });
    await prisma.$transaction([prisma.mark.deleteMany({ where: { creatorId: member.id } }), prisma.member.delete({ where: { id: member.id } })]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: '删除成员失败' }); }
});
router.get('/:id/cues', async (req, res) => {
  try {
    const ensemble = await prisma.ensemble.findUnique({ where: { id: req.params.id } });
    if (!ensemble) return res.status(404).json({ error: '乐团不存在' });
    const memberId = typeof req.query.memberId === 'string' ? req.query.memberId : undefined;
    const viewer = memberId ? await prisma.member.findFirst({ where: { id: memberId, ensembleId: ensemble.id } }) : null;
    if (memberId && !viewer) return res.status(403).json({ error: '成员无权访问此乐团' });
    const events = await prisma.rehearsalEvent.findMany({ where: { type: 'CUE_SENT', rehearsal: { ensembleId: ensemble.id } }, orderBy: { timestamp: 'desc' }, take: 100 });
    res.json(events.map(event => parseJSON(event.data)).filter(data => canReceiveTarget(data, viewer)).reverse());
  } catch { res.status(500).json({ error: '获取提示历史失败' }); }
});
router.get('/:id/sections', async (req, res) => {
  try {
    const sections = await prisma.member.groupBy({ by: ['section'], where: { ensembleId: req.params.id, section: { not: null } }, _count: { section: true } });
    res.json(sections.map(s => ({ name: s.section, memberCount: s._count.section })));
  } catch { res.status(500).json({ error: '获取声部列表失败' }); }
});
export default router;
