import type { Mark } from '../../types'
import { SECTIONS } from '../../types'

export interface Point {
  x: number
  y: number
}

export interface HighlightRectangle extends Point {
  width: number
  height: number
}

interface MarkLayerProps {
  marks: Mark[]
  scoreId: string
  page: number
  isConductor: boolean
  playerSection?: string
  memberId?: string
  tempDrawingPath: Point[] | null
  tempHighlight: HighlightRectangle | null
}

export default function MarkLayer({
  marks,
  scoreId,
  page,
  isConductor,
  playerSection,
  memberId,
  tempDrawingPath,
  tempHighlight,
}: MarkLayerProps) {
  const visibleMarks = marks.filter(mark =>
    mark.scoreId === scoreId && mark.page === page &&
    (!mark.private || mark.creatorId === memberId) &&
    (isConductor || ((!mark.targetSection || mark.targetSection === playerSection) && (!mark.targetMemberId || mark.targetMemberId === memberId)))
  )

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {visibleMarks.map(mark => <MarkItem key={mark.id} mark={mark} />)}
      {tempDrawingPath && <DrawingPath path={tempDrawingPath} />}
      {tempHighlight && (
        <div className="absolute bg-yellow-300/50 rounded" style={{ left: tempHighlight.x, top: tempHighlight.y, width: tempHighlight.width, height: tempHighlight.height }} />
      )}
    </div>
  )
}

function MarkItem({ mark }: { mark: Mark }) {
  switch (mark.type) {
    case 'DRAWING':
      return <DrawingMark mark={mark} />
    case 'TEXT':
      return <TextMark mark={mark} />
    case 'HIGHLIGHT':
      return <HighlightMark mark={mark} />
    default:
      return null
  }
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false
  const point = value as Point
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function DrawingMark({ mark }: { mark: Mark }) {
  try {
    const data = JSON.parse(mark.data)
    // Early versions stored a raw array; keep those annotations readable.
    const points: unknown = Array.isArray(data) ? data : data?.path ?? data?.points
    if (!Array.isArray(points)) return null
    const path = points.filter(isPoint)
    const width = Number.isFinite(data?.width) ? Math.max(1, Math.min(20, data.width)) : 2
    const color = typeof data?.color === 'string' ? data.color : '#ef4444'
    return <DrawingPath path={path} width={width} color={color} />
  } catch {
    return null
  }
}

function DrawingPath({ path, width = 2, color = '#ef4444' }: { path: Point[]; width?: number; color?: string }) {
  if (path.length === 0) return null
  return (
    <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 10 }}>
      {path.length === 1 ? (
        <circle cx={path[0].x} cy={path[0].y} r={width / 2} fill={color} />
      ) : (
        <path
          d={`M ${path.map(point => `${point.x},${point.y}`).join(' L ')}`}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

function TextMark({ mark }: { mark: Mark }) {
  const sectionName = SECTIONS.find(section => section.id === mark.targetSection)?.name
  return (
    <div
      className="absolute bg-yellow-100 border border-yellow-300 px-2 py-1 rounded text-sm shadow-sm whitespace-pre-wrap break-words"
      style={{ left: mark.x, top: mark.y, maxWidth: 240, zIndex: 20 }}
    >
      {mark.data}
      {mark.private && <span className="block text-xs text-gray-500 mt-1">我的私密批注</span>}
      {mark.targetSection && (
        <span className="block text-xs text-gray-500 mt-1">目标: {sectionName || mark.targetSection}</span>
      )}
    </div>
  )
}

function HighlightMark({ mark }: { mark: Mark }) {
  return (
    <div
      className="absolute bg-yellow-300/50 rounded"
      style={{ left: mark.x, top: mark.y, width: mark.width ?? 100, height: mark.height ?? 30, zIndex: 5 }}
    />
  )
}
