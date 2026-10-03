import { Router, Request, ErrorRequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

const router = Router();
export const uploadsDirectory = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
for (const folder of ['scores', 'audio']) mkdirSync(path.join(uploadsDirectory, folder), { recursive: true });
const scoreExtensions = new Set(['.pdf', '.xml', '.musicxml', '.mxl']);
const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.mp4', '.aac', '.flac']);
const storage = multer.diskStorage({
  destination: (_req, file, cb) => cb(null, path.join(uploadsDirectory, file.fieldname === 'audio' ? 'audio' : 'scores')),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const allowed = file.fieldname === 'audio' ? audioExtensions : scoreExtensions;
  if (!allowed.has(path.extname(file.originalname).toLowerCase())) return cb(new Error('不支持的文件类型'));
  cb(null, true);
} });
function describe(file: Express.Multer.File, req: Request) {
  const origin = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return { fileUrl: `${origin}/uploads/${file.fieldname === 'audio' ? 'audio' : 'scores'}/${file.filename}`, fileType: path.extname(file.originalname).toLowerCase() === '.pdf' ? 'pdf' : 'musicxml', originalName: file.originalname, size: file.size };
}
router.post('/score', upload.single('score'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有上传乐谱文件' });
  res.json({ success: true, ...describe(req.file, req) });
});
router.post('/audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有上传音频文件' });
  res.json({ success: true, ...describe(req.file, req) });
});
router.post('/both', upload.fields([{ name: 'score', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (!files?.score?.[0]) return res.status(400).json({ error: '没有上传乐谱文件' });
  res.json({ success: true, score: describe(files.score[0], req), ...(files.audio?.[0] ? { audio: describe(files.audio[0], req) } : {}) });
});
const uploadError: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 50 MB' : error.message || '上传失败' });
};
router.use(uploadError);
export default router;
