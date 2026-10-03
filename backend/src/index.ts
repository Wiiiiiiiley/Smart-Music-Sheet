import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { setupSocketHandlers } from './socket/handlers';
import { setupWebRTCHandlers } from './webrtc/handlers';
import scoreRoutes from './routes/scores';
import ensembleRoutes from './routes/ensembles';
import rehearsalRoutes from './routes/rehearsals';
import uploadRoutes, { uploadsDirectory } from './routes/upload';

export { prisma } from './db';
export const app = express();
export const httpServer = createServer(app);
const origins = (process.env.FRONTEND_URL || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim());
export const io = new Server(httpServer, {
  cors: { origin: origins, methods: ['GET', 'POST'], credentials: true }
});

app.use(cors({ origin: origins, credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(path.resolve(uploadsDirectory)));
app.use('/api/scores', scoreRoutes);
app.use('/api/ensembles', ensembleRoutes);
app.use('/api/rehearsals', rehearsalRoutes);
app.use('/api/upload', uploadRoutes);
setupSocketHandlers(io);
setupWebRTCHandlers(io);
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof SyntaxError ? 400 : 500;
  console.error('Request failed:', error.message);
  res.status(status).json({ error: status === 400 ? '请求数据格式错误' : '服务器处理请求失败' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  httpServer.listen(port, () => console.log(`🎼 EduTempo 后端服务运行在端口 ${port}`));
}
