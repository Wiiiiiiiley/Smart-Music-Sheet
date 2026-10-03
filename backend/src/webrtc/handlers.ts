import { Server, Socket } from 'socket.io';
import { prisma } from '../db';

export function setupWebRTCHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    const error = (message: string) => socket.emit('error', { message });
    const leave = () => {
      const room = socket.data.audioRoom;
      if (!room) return;
      socket.to(room).emit('audio-member-left', { memberId: socket.data.memberId, socketId: socket.id });
      socket.leave(room);
      delete socket.data.audioRoom;
    };
    socket.on('join-audio-room', async (data: any) => {
      try {
        if (socket.data.ensembleId && socket.data.ensembleId !== data?.ensembleId) return error('音频房间必须属于当前乐团');
        const member = data && await prisma.member.findFirst({ where: { id: data.memberId, ensembleId: data.ensembleId } });
        if (!member) return error('请先加入乐团');
        const roomId = `audio:${member.ensembleId}`;
        if (socket.data.audioRoom && socket.data.audioRoom !== roomId) leave();
        const alreadyJoined = socket.data.audioRoom === roomId;
        socket.data.audioRoom = roomId;
        socket.data.memberId = member.id;
        socket.data.role = member.role;
        socket.data.section = member.section;
        await socket.join(roomId);
        const members = Array.from(io.sockets.adapter.rooms.get(roomId) || []).filter(id => id !== socket.id).map(id => {
          const target = io.sockets.sockets.get(id)!;
          return { socketId: id, memberId: target.data.memberId, section: target.data.section, role: target.data.role };
        });
        socket.emit('audio-room-members', members);
        if (!alreadyJoined) socket.to(roomId).emit('audio-member-joined', { memberId: member.id, section: member.section, role: member.role, socketId: socket.id });
      } catch { error('加入音频房间失败'); }
    });
    for (const event of ['webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate']) {
      socket.on(event, (data: any) => {
        const target = data && io.sockets.sockets.get(data.to);
        if (!target || !socket.data.audioRoom || socket.data.audioRoom !== target.data.audioRoom) return;
        target.emit(event, { from: socket.id, signal: data.signal, memberId: socket.data.memberId, section: socket.data.section, role: socket.data.role });
      });
    }
    const broadcast = (event: string, data: any) => {
      const room = event === 'audio-control' && socket.data.ensembleId ? `ensemble:${socket.data.ensembleId}` : socket.data.audioRoom;
      if (socket.data.role !== 'CONDUCTOR' || !room) return error('只有指挥可以控制音频');
      for (const id of io.sockets.adapter.rooms.get(room) || []) {
        const target = io.sockets.sockets.get(id);
        if (!target || id === socket.id) continue;
        if (data.targetMemberId && target.data.memberId !== data.targetMemberId) continue;
        if (data.targetSection && target.data.section !== data.targetSection) continue;
        target.emit(event, data);
      }
    };
    socket.on('audio-control', (data: any) => { if (data) broadcast('audio-control', data); });
    socket.on('send-cue-audio', (data: any) => { if (data) broadcast('cue-audio', { ...data, fromConductor: true, timestamp: Date.now() }); });
    socket.on('leave-audio-room', leave);
    socket.on('disconnecting', leave);
  });
}
