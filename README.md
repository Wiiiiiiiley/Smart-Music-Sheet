# EduTempo — Intelligent Ensemble Rehearsal System

EduTempo is an intelligent rehearsal system designed for non-professional ensembles, including student orchestras, community ensembles, amateur orchestras, and traditional Chinese instrumental ensembles.

It addresses common rehearsal challenges such as overlapping instrumental parts, difficult score annotation, and disorganized sheet music management. With **real-time conductor annotations**, **section-specific audio cues**, and **cross-device score synchronization**, EduTempo makes every rehearsal more efficient.

## Key Features

### Conductor Interface
- **乐谱管理**：上传 PDF/MusicXML 格式的乐谱
- **实时标记**：在乐手谱面上圈画、批注，实时同步到所有客户端
- **分声部提示**：向指定声部或全体发送提示音、节拍器、示范音频
- **排练控制**：开始/停止排练，查看排练进度
- **成员管理**：查看乐团成员列表，按声部筛选
- **多声部打谱**：新建管弦乐总谱，输入音符、休止符、和弦、四个声部、附点、三连音、延音线、力度及歌词；保存后直接用于排练
- **实时讲话与录音**：向全体、声部或个人传输指挥麦克风音频，保存排练录音及事件时间线
- **小节定位**：MusicXML 小节位置与时间解析、PDF 小节候选识别及手工校准，设置"还有 X 小节进入"

### Musician Interface
- **电子乐谱**：使用平板或手机打开电子乐谱
- **分声部音频**：佩戴耳机收听自己声部的排练提示音轨
- **实时标记**：接收指挥的实时标记与文字备注
- **音频控制**：独立调节各声道音量
- **个人笔记**：在谱面绘图、写字并保存自己的私密批注
- **回听与反馈**：回听关键提示，接收指挥标记的错音、节奏及技巧反馈，查看排练复盘

### Frontend Stack
- **React** + **TypeScript** - UI 框架
- **Vite** - 构建工具
- **Tailwind CSS** - 样式
- **Zustand** - 状态管理
- **Socket.io-client** - WebSocket 客户端
- **PDF.js** - PDF 分页渲染
- **OpenSheetMusicDisplay / VexFlow** - MusicXML/MXL 乐谱渲染
- **Lucide React** - 图标库

## Technology Stack

### Backend

- **Node.js** + **Express** — Web server framework
- **Socket.io** — Real-time WebSocket communication
- **Prisma** + **SQLite** — ORM and database
- **Multer** — File upload handling
- **WebRTC Signaling** — Signaling for low-latency audio distribution

### Frontend

- **React** + **TypeScript** — User interface framework
- **Vite** — Build tool
- **Tailwind CSS** — Styling
- **Zustand** — State management
- **Socket.io-client** — WebSocket client
- **VexFlow** — Music notation rendering
- **Lucide React** — Icon library

## Quick Start

### Install Dependencies

```bash
# Install dependencies from the project root
npm run install:all

# Alternatively, install backend and frontend dependencies separately
cd backend && npm install
cd ../frontend && npm install
```

### Initialize the Database

```bash
cd backend
npm run db:setup
```

### Start the Development Servers

```bash
# Start both servers from the project root
npm run dev

# Alternatively, start each server separately

# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

### Access the Application

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

<<<<<<< HEAD
## Usage Workflow
=======
## 验证修复

```bash
npm run build
npm --prefix backend-wrangler run build
npm test
```

测试仅使用临时 SQLite/D1/R2 数据，不修改现有乐团或乐谱。`scripts/fixtures` 提供双页 PDF、MusicXML、MXL 验收文件。

本地前端默认通过 Vite 代理访问后端。跨设备访问时使用可达的后端地址，并把设备的前端来源加入 `FRONTEND_URL`。生产 Pages/Workers 的构建变量及实时协议配置见 [DEPLOY.md](DEPLOY.md)。

## 使用流程

### 1. Create an Ensemble — Conductor

- Open the homepage and select **“I’m a Conductor.”**
- Enter the required information and create an ensemble.
- Add ensemble members.

### 2. Upload a Score — Conductor

- Open the conductor interface.
- Click **“Upload Score.”**
- Select a PDF or MusicXML file.
- Optionally upload a reference audio recording.

### 3. Join the Ensemble — Musician

- Open the homepage and select **“I’m a Musician.”**
- Enter the ensemble ID to join.
- Wait for the conductor to select a score and start the rehearsal.

### 4. Start Rehearsing — Conductor

- Select a score.
- Annotate the score using the annotation tools.
- Send audio cues to specific instrumental sections.
- Start and stop the rehearsal as needed.

## Project Structure

```text
edu/
├── backend/                 # Backend service
│   ├── src/
│   │   ├── index.ts         # Application entry point
│   │   ├── socket/          # WebSocket handlers
│   │   ├── webrtc/          # WebRTC signaling
│   │   └── routes/          # API routes
│   ├── prisma/              # Database schema
│   └── uploads/             # Uploaded files
├── frontend/                # Frontend application
│   ├── src/
│   │   ├── pages/           # Page components
│   │   ├── components/      # Reusable components
│   │   ├── stores/          # State management
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Utility functions
│   └── public/              # Static assets
└── package.json             # Root package configuration
```

## API Endpoints

### Ensemble Management

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| GET | `/api/ensembles` | List ensembles |
| POST | `/api/ensembles` | Create an ensemble |
| GET | `/api/ensembles/:id` | Get ensemble details |
| POST | `/api/ensembles/:id/members` | Add an ensemble member |

### Score Management

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| GET | `/api/scores` | List scores |
| POST | `/api/scores` | Create a score |
| GET | `/api/scores/:id` | Get score details |
| GET | `/api/scores/:id/marks` | Get score annotations |

### File Uploads

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| POST | `/api/upload/score` | Upload a score file |
| POST | `/api/upload/audio` | Upload an audio file |

### Rehearsals

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| GET | `/api/rehearsals` | List rehearsal records |
| POST | `/api/rehearsals/start` | Start a rehearsal |
| POST | `/api/rehearsals/:id/end` | End a rehearsal |

## WebSocket Events

### Client Events

2. **音频提示**
   - 实际播放预备拍、提示音和节拍器
   - 播放附带的参考音频，支持主音量及声道音量
   - 首次播放须由乐手点击"启用提示音"
    - WebRTC 实际传输麦克风音频，支持定向讲话与浏览器连接质量指标

| Event | Description |
|:------|:------------|
| `join-ensemble` | Join an ensemble room |
| `add-mark` | Add an annotation |
| `send-cue` | Send a rehearsal cue |
| `cursor-move` | Send a cursor position update |
| `rehearsal-start` | Start a rehearsal |
| `rehearsal-stop` | Stop a rehearsal |

### Server Broadcasts

| Event | Description |
|:------|:------------|
| `mark-added` | A new annotation has been added |
| `cue-received` | A rehearsal cue has been received |
| `member-joined` | A member has joined |
| `member-left` | A member has left |
| `rehearsal-started` | The rehearsal has started |
| `rehearsal-stopped` | The rehearsal has stopped |

## Roadmap

- [ ] AI 音准评分
- [x] 排练录音与复盘
- [x] 换谱与翻页同步
- [x] MusicXML 小节定位 / PDF 小节候选识别与校准
- [ ] 离线模式支持

## Technical Highlights

### Real-Time Collaborative Annotations

- WebSocket-based synchronization.
- Support for drawing, text, and highlighting.
- Annotations can be directed to specific instrumental sections.

### Low-Latency Audio Distribution

- WebRTC audio streaming.
- Target latency of less than **50 ms**.
- Independent volume controls for section-specific audio.

### Cross-Device Support

- Responsive layouts for tablets and smartphones.
- Browser-based access on desktop, iPad, and Android tablets.
- Touch-friendly controls.

## 多声部打谱

指挥创建乐团后点击"新建总谱"，默认提供四个弦乐声部，也可增删、排序乐器并设置谱号与移调。`N` 切换输入模式，`1–7` 选择时值，`A–G` 输入音高，`0` 输入休止符，`.` 附点，`T` 延音线；页面快捷键帮助包含和弦、四声部切换和撤销等操作。

工作台支持本地草稿、MusicXML/MXL 导入、MusicXML 与 MIDI 导出，以及分声部试听和音量。点击"保存到乐团"后总谱会作为真实 MusicXML 乐谱上传、保存并同步。已有 MusicXML 可通过"编辑此谱"继续修改。

当前编辑器支持最多 32 个独立谱表、200 小节和全曲统一拍号、调号与速度。含变拍号、转调、速度变化、多谱表钢琴或装饰音等复杂作品会提示不支持编辑，可直接上传到排练阅读器显示。网站实现常用打谱流程；完整 MuseScore 4 专业排版能力不在此版本范围内。

## 验收与运行边界

功能与测试结果见 [FEATURE_ACCEPTANCE.md](FEATURE_ACCEPTANCE.md)。实时语音和录音需要 HTTPS（localhost 开发除外）及指挥允许麦克风权限。跨网部署按 [DEPLOY.md](DEPLOY.md) 配置 TURN。文档的低于 50 ms 目标需用真实设备和排练网络验收，本机测试不能证明该指标。AI 音准评分仍按文档的 MVP 范围保留为后续功能。

## License

MIT License
