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

### GitHub Actions 发布凭证

`.github/workflows/deploy.yml` 在推送 `main` 或手工运行时发布；Pull Request 不发布生产站点。流程先检查四个 Actions Secrets，然后对 Worker 进行类型检查、集成测试、D1 migration、发布及版本和路由校验；全部成功后才构建并发布前端。后端失败时，前端发布任务会跳过。

若出现 `In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN`，表示运行器没有取得 Token。工作流已使用 `${{ secrets.CLOUDFLARE_API_TOKEN }}`；需要配置 GitHub 仓库密钥，修改网站代码或执行 `wrangler login` 不能替代此步骤。

1. 按 [Cloudflare 的 GitHub Actions 认证说明](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 创建 API Token，使用 **Edit Cloudflare Workers** 模板，将账户范围限制为本项目所在账户。此流程会发布 Pages 并自动应用远程 D1 migration，还需 **Account → Cloudflare Pages → Edit** 和 **Account → D1 → Edit** 权限。
2. 打开 [Music-EDU 的 Actions Secrets 设置](https://github.com/Wiiiiiiiley/Music-EDU/settings/secrets/actions)，选择 **New repository secret**，分别添加：

| Secret 名称 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 创建的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID（账户 ID，非 Zone ID） |
| `VITE_API_URL` | Worker API 地址，例如 `https://edutempo-api.wileymei3.workers.dev` |
| `VITE_WS_URL` | 实时服务地址，例如 `wss://edutempo-api.wileymei3.workers.dev/ws` |

凭证必须放在 **Actions 的 Repository secrets**；同名的 Variables、Dependabot secrets 或 Cloudflare Pages 构建变量不会被这个工作流的 `secrets` 表达式读取。若使用 GitHub Environment secrets，需在工作流 job 声明相应的 `environment`；当前工作流使用 Repository secrets。

配置并提交、推送修复后，在 GitHub **Actions → Deploy to Cloudflare** 中选择 **Run workflow**，分支选 `main`。重新运行旧任务仍使用它原来的提交，不包含新修复。Token 只保存在 GitHub Secrets 中，不写入源码、`.env`、聊天或日志。Wrangler 的版本更新提示是警告，不能通过升级来解决缺失 Token。

### WebSocket 和提示记录返回 404

如果浏览器连接 `/ws?ensembleId=...&userId=...` 时握手返回 404，且提示记录 `/api/ensembles/:id/cues` 也返回 404，先查看 **Deploy Backend (Workers)** 任务。前端成功发布不代表后端已更新；只有 Pages 更新时，浏览器仍可能连接缺少这些接口的旧 Worker。不要通过修改前端协议来绕过尚未发布的后端。

更新后的 `/health` 返回 `apiVersion: 2`、`capabilities` 和 `revision`。CI 将当前 Git 提交写入 `APP_REVISION`，发布后的只读校验要求线上版本与本次提交相同，并确认两个路由存在；不满足就中止前端发布。校验脚本不会创建乐团或成员，也不会修改生产数据。

正常的普通 HTTP `GET /ws` 返回 **426**（需要 WebSocket Upgrade）；真正的 WebSocket 握手返回 **101**。提示记录接口在有效乐团和成员下返回 **200**。`{"error":"Not Found"}` 表示路由未匹配；`{"error":"乐团不存在"}` 表示路由已匹配但没有该乐团，需要核对前端指向的 Worker 和该 Worker 的 D1 绑定。

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
