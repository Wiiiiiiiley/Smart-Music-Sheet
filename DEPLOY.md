# EduTempo 部署

支持两个后端，前端必须同时连接同一个后端的 API 和实时服务。

## Cloudflare Pages + Workers（现有部署）

Worker 使用 D1 保存乐团、乐谱、批注和排练；R2 保存文件；Durable Object 管理每个乐团的实时房间。它的 `/ws` 是原生 WebSocket，消息格式为 `{event, data}`，不可连接 Socket.IO 客户端。

1. 在 `backend-wrangler/wrangler.toml` 填入 D1 数据库 ID、R2 桶名。保持 `WEBSOCKET` binding、导出的 `WebSocketServer` 和 `v1` SQLite Durable Object migration。
2. 安装并迁移、发布后端：

```bash
npm ci
npm --prefix backend-wrangler ci
cd backend-wrangler
npx wrangler d1 migrations apply edutempo-db --remote
npx wrangler deploy
cd ..
```

3. 将 `frontend/.env.production.example` 复制为 `frontend/.env.production`，填入实际 Worker URL。已有生产配置保留即可。

```dotenv
VITE_API_URL=https://your-api.workers.dev
VITE_WS_URL=wss://your-api.workers.dev/ws
VITE_REALTIME_TRANSPORT=websocket
```

4. 构建并发布前端：

```bash
npm run build:frontend
cd frontend
npx wrangler pages deploy dist --project-name edutempo
```

Vite 环境变量在构建时写入静态 JS。`wrangler.toml` 的运行时 vars 不能改变已构建文件的地址。Pages Git 构建时应配置对应构建环境变量，根目录选仓库根、命令 `npm run build:frontend`、输出目录 `frontend/dist`。

### Pages Git 构建配置

在 Cloudflare Dashboard 的 Pages 项目中，进入 **Settings → Builds & deployments → Build configuration**，使用以下设置：

| 设置 | 值 |
| --- | --- |
| 根目录 | 仓库根目录（留空） |
| 构建命令 | `npm run build:frontend` |
| 构建输出目录 | `frontend/dist` |

仓库根的 `wrangler.toml` 已通过 `pages_build_output_dir = "frontend/dist"` 声明同一个输出路径。`frontend/wrangler.toml` 的 `dist` 则供从 `frontend` 目录执行的 CLI 发布使用。

若日志显示 Vite 构建成功，随后出现 `Error: Output directory "dist" not found`，原因是 Pages 在仓库根寻找 `dist`，而实际文件位于 `frontend/dist`。提交并推送根配置的修复，将 Dashboard 输出目录改为 `frontend/dist`，然后重新部署。已有的 `npm run build` 也能生成前端文件，但还会构建用于 Node.js 的 Express 后端；Pages 只需构建前端。

Pages Git 构建只发布前端，不会自动迁移 D1 或发布 `backend-wrangler`。更新协作功能后，仍需执行上面的 Worker migration 和发布步骤。

上传返回 Worker 自身的 `/api/upload/files/...` 地址，由 R2 绑定读取，无需公开 R2 桶域名。PDF CMaps、标准字体和 worker 脚本随前端构建发布。

## Express + Socket.IO

适合本地开发或具有 Node.js 服务的托管平台。配置 `DATABASE_URL`、`PORT`、`FRONTEND_URL`，执行 Prisma migration，构建并运行 `backend/dist/index.js`。数据库和 `backend/uploads` 必须放在持久存储中；生产 SQLite 不应存放于临时容器目录。

前端构建变量使用同一个 Express 服务：

```dotenv
VITE_API_URL=https://your-node-backend.example.com
VITE_WS_URL=https://your-node-backend.example.com
VITE_REALTIME_TRANSPORT=socketio
```

代理需要支持 `/socket.io` WebSocket 升级及 `/uploads` 静态文件。HTTPS 前端必须使用 HTTPS/WSS 后端。

## 验证

检查 `/health`，创建乐团、复制乐团 ID，上传 PDF/MusicXML/MXL。在另一台设备以乐手加入，测试换谱、翻页、批注、声部提示、排练开始/停止及断线重连。

浏览器首次播放音频需要乐手点击“启用提示音”，接收讲话时点击“接收指挥音频”。指挥在“实时语音通道”点击“开启麦克风”。实时讲话使用实际 WebRTC 音频轨道，WebSocket 负责 SDP / ICE 信令。HTTPS 和麦克风权限是远程设备使用语音与录音的前提。

## WebRTC 跨网配置

默认 ICE 使用 STUN。限制严格的 NAT / 防火墙环境需配置可达的 TURN，构建前设置 `VITE_ICE_SERVERS` 为 JSON 数组：

```dotenv
VITE_ICE_SERVERS='[{"urls":"stun:your-stun.example.com:3478"},{"urls":["turn:your-turn.example.com:3478?transport=udp","turns:your-turn.example.com:5349?transport=tcp"],"username":"temporary-user","credential":"temporary-credential"}]'
```

所有 `VITE_` 变量会包含在前端文件中；填写服务颁发的短期凭证，不要填写 TURN 服务管理密钥。此版本读取构建时的 ICE 配置，短期凭证到期需更新配置；长期公网部署应扩展后端短期凭证签发接口。

每位乐手与指挥建立独立音频连接。现场容量取决于指挥设备和上行带宽；大型乐团需先在目标人数下测量。面板显示真实 RTT、抖动和平均抖动缓冲时间，RTT 不等于端到端单程音频延迟。低于 50 ms 的目标需要在实际设备、耳机和网络环境中测量。

部署新功能时先备份 SQLite / D1，再应用新增的协作功能 migration；不要用 `db push --force-reset` 覆盖现有数据。本地 `npm run db:setup` 或 `npm run dev:backend` 会执行保留数据的 Prisma migration。Worker 需执行前文的 D1 migration。音轨、小节框和私密批注依赖这些新增字段。
