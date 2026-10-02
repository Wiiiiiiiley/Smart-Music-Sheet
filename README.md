# EduTempo — Intelligent Ensemble Rehearsal System

EduTempo is an intelligent rehearsal system designed for non-professional ensembles, including student orchestras, community ensembles, amateur orchestras, and traditional Chinese instrumental ensembles.

It addresses common rehearsal challenges such as overlapping instrumental parts, difficult score annotation, and disorganized sheet music management. With **real-time conductor annotations**, **section-specific audio cues**, and **cross-device score synchronization**, EduTempo makes every rehearsal more efficient.

## Key Features

### Conductor Interface

- **Score Management**: Upload scores in PDF or MusicXML format.
- **Real-Time Annotations**: Draw and annotate on musicians’ scores, with changes synchronized instantly across connected devices.
- **Section-Specific Cues**: Send audio cues, metronome beats, and demonstration recordings to selected sections or the entire ensemble.
- **Rehearsal Control**: Start and stop rehearsals and monitor rehearsal progress.
- **Member Management**: View ensemble members and filter them by instrumental section.

### Musician Interface

- **Digital Scores**: View sheet music on a tablet or smartphone.
- **Section-Specific Audio**: Listen to rehearsal cues for your own section through headphones.
- **Live Annotations**: Receive the conductor’s annotations and text notes in real time.
- **Audio Controls**: Adjust the volume of individual audio channels independently.

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
npx prisma migrate dev
npx prisma generate
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

## Usage Workflow

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

## Roadmap

- [ ] AI-assisted pitch accuracy assessment
- [ ] Rehearsal recording and review
- [ ] Automatic score page turning
- [ ] Intelligent barline alignment
- [ ] Offline mode

## License

MIT License.
