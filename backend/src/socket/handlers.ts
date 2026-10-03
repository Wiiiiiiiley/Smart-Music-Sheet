import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { getEnsembleState, setEnsemblePublisher } from '../realtime';
import { canSeeMark, canReceiveTarget, text, validatePosition, FeatureError } from '../features';

export function setupSocketHandlers(io: Server) {
  setEnsemblePublisher((ensembleId, event, data) => io.to(`ensemble:${ensembleId}`).emit(event, data));
  io.on('connection', (socket: Socket) => {
    const room = () => socket.data.ensembleId ? `ensemble:${socket.data.ensembleId}` : null;
    const error = (message: string) => socket.emit('error', { message });
    const conductor = () => !!room() && socket.data.role === 'CONDUCTOR';
    const viewer = (target: Socket) => ({ id: target.data.memberId, role: target.data.role, section: target.data.section });
    const broadcast = (event: string, data: any, visible: (target: Socket) => boolean = () => true, echo = true) => {
      const roomId = room();
      if (!roomId) return;
      for (const id of io.sockets.adapter.rooms.get(roomId) || []) {
        const target = io.sockets.sockets.get(id);
        if (target && (echo || id !== socket.id) && visible(target)) target.emit(event, data);
      }
    };
    const targets = async (data: any) => {
      const targetSection = text(data?.targetSection, 100), targetMemberId = text(data?.targetMemberId, 200);
      if (data?.targetMemberId && !targetMemberId) throw new FeatureError('目标成员无效');
      if (targetMemberId && !await prisma.member.findFirst({ where: { id: targetMemberId, ensembleId: socket.data.ensembleId } })) throw new FeatureError('目标成员不属于当前乐团');
      return { targetSection, targetMemberId };
    };
    const persistEvent = async (type: string, data: any) => {
      const active = await prisma.rehearsal.findFirst({ where: { ensembleId: socket.data.ensembleId, endedAt: null }, orderBy: { startedAt: 'desc' } });
      if (active) await prisma.rehearsalEvent.create({ data: { id: data.id, rehearsalId: active.id, type, data: JSON.stringify(data) } });
    };
    const action = (name: string, fn: (data: any) => Promise<any>) => socket.on(name, async data => {
      try { await fn(data); } catch (failure) { error(failure instanceof FeatureError ? failure.message : '操作失败，请重试'); }
    });
    const leave = () => {
      const roomId = room();
      if (!roomId) return;
      socket.to(roomId).emit('member-left', { memberId: socket.data.memberId, socketId: socket.id });
      socket.leave(roomId);
      delete socket.data.ensembleId;
    };
    action('join-ensemble', async data => {
      if (!data || typeof data.ensembleId !== 'string' || typeof data.memberId !== 'string') throw new FeatureError('乐团或成员信息无效');
      const member = await prisma.member.findFirst({ where: { id: data.memberId, ensembleId: data.ensembleId } });
      if (!member) throw new FeatureError('请先加入乐团');
      if (socket.data.ensembleId && socket.data.ensembleId !== data.ensembleId) leave();
      const alreadyJoined = socket.data.ensembleId === data.ensembleId;
      Object.assign(socket.data, { ensembleId: member.ensembleId, memberId: member.id, role: member.role, section: member.section });
      await socket.join(`ensemble:${member.ensembleId}`);
      const roster = Array.from(io.sockets.adapter.rooms.get(room()!) || []).filter(id => id !== socket.id).map(id => {
        const target = io.sockets.sockets.get(id)!;
        return { socketId: id, memberId: target.data.memberId, role: target.data.role, section: target.data.section };
      });
      socket.emit('room-members', roster);
      if (!alreadyJoined) socket.to(room()!).emit('member-joined', { socketId: socket.id, memberId: member.id, role: member.role, section: member.section });
      const state = getEnsembleState(member.ensembleId);
      if (!state.scoreId) {
        const active = await prisma.rehearsal.findFirst({ where: { ensembleId: member.ensembleId, endedAt: null }, orderBy: { startedAt: 'desc' } });
        if (active?.scoreId) Object.assign(state, { scoreId: active.scoreId, rehearsalId: active.id, isRehearsing: true });
      }
      if (state.scoreId) socket.emit('score-selected', { scoreId: state.scoreId });
      socket.emit('page-changed', { page: state.page, scoreId: state.scoreId });
      if (state.isRehearsing) socket.emit('rehearsal-started', { scoreId: state.scoreId, rehearsalId: state.rehearsalId });
      if (state.position) socket.emit('position-updated', state.position);
    });
    socket.on('leave-ensemble', leave);
    action('add-mark', async data => {
      if (!room()) throw new FeatureError('请先加入乐团');
      if (!data || !['DRAWING', 'TEXT', 'HIGHLIGHT'].includes(data.type) || typeof data.data !== 'string' || data.data.length > 1000000 || !Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 0 || data.y < 0 || !Number.isInteger(data.page) || data.page < 1) throw new FeatureError('标记数据无效');
      const score = await prisma.score.findFirst({ where: { id: data.scoreId, ensembleId: socket.data.ensembleId } });
      if (!score) throw new FeatureError('乐谱不存在');
      const target = conductor() ? await targets(data) : {};
      const mark = await prisma.mark.create({ data: { type: data.type, data: data.data, x: data.x, y: data.y, width: Number.isFinite(data.width) && data.width >= 0 ? data.width : undefined, height: Number.isFinite(data.height) && data.height >= 0 ? data.height : undefined, page: data.page, scoreId: score.id, creatorId: socket.data.memberId, ...target, private: !conductor() || data.private === true }, include: { creator: { select: { name: true, role: true, section: true } } } });
      broadcast('mark-added', mark, targetSocket => canSeeMark(mark, viewer(targetSocket)));
    });
    action('delete-mark', async markId => {
      if (!room()) throw new FeatureError('请先加入乐团');
      const mark = typeof markId === 'string' ? await prisma.mark.findFirst({ where: { id: markId, score: { ensembleId: socket.data.ensembleId } } }) : null;
      if (!mark || (!conductor() && mark.creatorId !== socket.data.memberId)) throw new FeatureError('不能删除此标记');
      await prisma.mark.delete({ where: { id: mark.id } });
      broadcast('mark-deleted', mark.id, target => canSeeMark(mark, viewer(target)));
    });
    action('send-cue', async data => {
      if (!conductor()) throw new FeatureError('只有指挥可以发送提示');
      if (!data || !['CLICK', 'COUNT_IN', 'METRONOME', 'DEMO_AUDIO'].includes(data.type)) throw new FeatureError('提示数据无效');
      const state = getEnsembleState(socket.data.ensembleId);
      const scoreId = text(data.scoreId, 200) || state.scoreId;
      if (scoreId && !await prisma.score.findFirst({ where: { id: scoreId, ensembleId: socket.data.ensembleId } })) throw new FeatureError('乐谱不存在');
      if (data.bpm !== undefined && (!Number.isFinite(data.bpm) || data.bpm < 20 || data.bpm > 400)) throw new FeatureError('速度无效');
      const cue = { ...data, ...await targets(data), private: false, id: randomUUID(), timestamp: Date.now(), scoreId, currentMeasure: data.currentMeasure || data.measureNumber || state.position?.measure || 1, fromConductor: true };
      await persistEvent('CUE_SENT', cue);
      broadcast('cue-received', cue, target => canReceiveTarget(cue, viewer(target)));
    });
    action('send-mistake', async data => {
      if (!conductor()) throw new FeatureError('只有指挥可以发送演奏反馈');
      if (!room() || !data || !text(data.kind, 100) || !Number.isInteger(data.measure) || data.measure < 1) throw new FeatureError('错音反馈数据无效');
      const scoreId = text(data.scoreId, 200) || getEnsembleState(socket.data.ensembleId).scoreId;
      if (!scoreId || !await prisma.score.findFirst({ where: { id: scoreId, ensembleId: socket.data.ensembleId } })) throw new FeatureError('乐谱不存在');
      const report = { ...await targets(data), scoreId, measure: data.measure, kind: text(data.kind, 100), note: text(data.note, 2000) || '', reporterId: socket.data.memberId, id: randomUUID(), timestamp: Date.now() };
      await persistEvent('MISTAKE_REPORTED', report);
      broadcast('mistake-received', report, target => canReceiveTarget(report, viewer(target)));
    });
    action('score-select', async data => {
      if (!conductor()) throw new FeatureError('只有指挥可以选择乐谱');
      const score = await prisma.score.findFirst({ where: { id: data?.scoreId, ensembleId: socket.data.ensembleId } });
      if (!score) throw new FeatureError('乐谱不存在');
      const state = getEnsembleState(socket.data.ensembleId);
      if (state.scoreId !== score.id) Object.assign(state, { scoreId: score.id, page: 1, position: undefined });
      broadcast('score-selected', { scoreId: score.id });
      broadcast('page-changed', { page: state.page, scoreId: score.id });
    });
    socket.on('page-change', data => {
      const page = typeof data === 'number' ? data : data?.page;
      if (!conductor() || !Number.isInteger(page) || page < 1) return;
      getEnsembleState(socket.data.ensembleId).page = page;
      broadcast('page-changed', { page, scoreId: getEnsembleState(socket.data.ensembleId).scoreId }, undefined, false);
    });
    socket.on('cursor-move', data => broadcast('cursor-moved', { ...data, memberId: socket.data.memberId, role: socket.data.role }, undefined, false));
    action('rehearsal-start', async data => {
      if (!conductor()) throw new FeatureError('只有指挥可以开始排练');
      const rehearsal = await prisma.rehearsal.findFirst({ where: { id: data?.rehearsalId, ensembleId: socket.data.ensembleId, scoreId: data?.scoreId, endedAt: null } });
      if (!rehearsal) throw new FeatureError('排练记录不存在');
      const state = getEnsembleState(socket.data.ensembleId);
      Object.assign(state, { scoreId: rehearsal.scoreId, rehearsalId: rehearsal.id, isRehearsing: true, page: state.scoreId === rehearsal.scoreId ? state.page : 1 });
      broadcast('rehearsal-started', { scoreId: rehearsal.scoreId, rehearsalId: rehearsal.id });
    });
    socket.on('rehearsal-stop', () => {
      if (!conductor()) return;
      const state = getEnsembleState(socket.data.ensembleId);
      Object.assign(state, { isRehearsing: false, rehearsalId: undefined });
      if (state.position) state.position = { ...state.position, running: false };
      broadcast('rehearsal-stopped', undefined);
      if (state.position) broadcast('position-updated', state.position);
    });
    action('current-position', async data => {
      if (!conductor()) throw new FeatureError('只有指挥可以同步演奏位置');
      const state = getEnsembleState(socket.data.ensembleId);
      const position = validatePosition(data, state.scoreId);
      if (!position.scoreId || !await prisma.score.findFirst({ where: { id: position.scoreId, ensembleId: socket.data.ensembleId } })) throw new FeatureError('乐谱不存在');
      state.position = { ...(state.position?.scoreId === position.scoreId ? state.position : {}), ...position, memberId: socket.data.memberId };
      broadcast('position-updated', state.position);
    });
    socket.on('disconnecting', leave);
  });
}
