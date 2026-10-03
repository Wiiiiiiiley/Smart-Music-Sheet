import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Score, MeasureRegion } from '../../types'
import { useAppStore } from '../../stores/appStore'
import { useSocketStore } from '../../stores/socketStore'
import { resolveAssetUrl, apiFetch } from '../../utils/api'
import { unpackXml, xmlTimeline, detectPdfBars } from '../../score/timeline'
import { useScoreSession } from '../../score/scoreSession'
import MarkLayer from './MarkLayer'
import type { HighlightRectangle, Point } from './MarkLayer'
import PageNavigator from './PageNavigator'

const SCORE_WIDTH = 900
const DEFAULT_HEIGHT = Math.round(SCORE_WIDTH * 297 / 210)

interface ScoreViewerProps {
  score: Score
  activeTool: 'select' | 'pen' | 'highlight' | 'text'
  selectedSection?: string | null
  selectedMemberId?: string | null
  isConductor: boolean
}

interface AnnotationContext {
  scoreId: string
  page: number
  creatorId: string
  targetSection?: string
  targetMemberId?: string
  private?: boolean
}

interface Stroke {
  pointerId: number
  tool: 'pen' | 'highlight' | 'layout'
  points: Point[]
  context: AnnotationContext
}

interface MusicPage {
  svg: SVGSVGElement
  height: number
}

function rectangleBetween(first: Point, last: Point): HighlightRectangle {
  return {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width: Math.abs(last.x - first.x),
    height: Math.abs(last.y - first.y),
  }
}

export default function ScoreViewer({ score, activeTool, selectedSection, selectedMemberId, isConductor }: ScoreViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The renderer owns this empty host. React owns the annotation layer beside it.
  const musicHostRef = useRef<HTMLDivElement>(null)
  const musicPagesRef = useRef<MusicPage[]>([])
  const musicFileKeyRef = useRef<string | null>(null)
  const strokeRef = useRef<Stroke | null>(null)
  const { currentUser, currentPage, currentMeasure, setCurrentMeasure, setCurrentPage, marks } = useAppStore()
  const { sendMark, deleteMark, socket, isConnected } = useSocketStore()
  const { regions, setRegions, setTimeline } = useScoreSession()
  const [fit, setFit] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [showBars, setShowBars] = useState(true)
  const [aligning, setAligning] = useState(false)
  const [alignNumber, setAlignNumber] = useState(1)
  const [layoutMessage, setLayoutMessage] = useState('')
  const [savingLayout, setSavingLayout] = useState(false)
  const [pdfDocument, setPdfDocument] = useState<{ document: PDFDocumentProxy; fileKey: string } | null>(null)
  const [renderedPageKey, setRenderedPageKey] = useState<string | null>(null)
  const [musicRevision, setMusicRevision] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [surfaceHeight, setSurfaceHeight] = useState(DEFAULT_HEIGHT)
  const [loading, setLoading] = useState(true)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [drawingPath, setDrawingPath] = useState<Point[] | null>(null)
  const [highlight, setHighlight] = useState<HighlightRectangle | null>(null)
  const [textInput, setTextInput] = useState<(Point & { value: string; context: AnnotationContext }) | null>(null)
  const isPdf = score.fileType === 'pdf'
  const fileKey = JSON.stringify([score.id, score.fileUrl, score.title, isPdf, retryCount])
  const pageKey = JSON.stringify([fileKey, currentPage])
  const isLoading = loading || (!renderError && renderedPageKey !== pageKey)
  const canAnnotate = isConnected && !!currentUser && !isLoading && !renderError
  const scale = fit ? fitScale : zoom
  const pageRegions = (regions[score.id] || []).filter(region => region.page === currentPage)
  const ownVisibleMarks = marks.filter(mark => mark.scoreId === score.id && mark.page === currentPage && ((!mark.private && isConductor) || mark.creatorId === currentUser?.id))

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => setFitScale(Math.max(.15, Math.min(1.5, (viewport.clientWidth - 32) / SCORE_WIDTH))))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setAligning(false); setLayoutMessage('')
    if (score.fileType === 'pdf') setRegions(score.id, score.measureRegions || [])
  }, [score.id, score.measureRegions, score.fileType, setRegions])

  useEffect(() => {
    let cancelled = false
    let pdfTask: PDFDocumentLoadingTask | undefined
    let stagingHost: HTMLDivElement | undefined
    const controller = new AbortController()
    setLoading(true)
    setRenderError(null)
    setPdfDocument(null)
    setRenderedPageKey(null)
    setTotalPages(1)
    setSurfaceHeight(DEFAULT_HEIGHT)
    musicPagesRef.current = []
    musicFileKeyRef.current = null
    setMusicRevision(revision => revision + 1)

    const loadScore = async () => {
      try {
        const assetUrl = resolveAssetUrl(score.fileUrl)
        if (!assetUrl) throw new Error('乐谱文件地址为空')
        if (isPdf) {
          const pdfjs = await import('pdfjs-dist')
          if (cancelled) return
          pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
          pdfTask = pdfjs.getDocument({ url: assetUrl, cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`, cMapPacked: true, standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/` })
          const document = await pdfTask.promise
          if (cancelled) return
          setTotalPages(document.numPages)
          setPdfDocument({ document, fileKey })
          const page = useAppStore.getState().currentPage
          if (page < 1 || page > document.numPages) setCurrentPage(1)
        } else {
          const response = await fetch(assetUrl, { signal: controller.signal })
          if (!response.ok) throw new Error(`文件读取失败 (${response.status})`)
          const content = await unpackXml(new Uint8Array(await response.arrayBuffer()))
          const timeline = xmlTimeline(content)
          const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay')
          if (cancelled) return
          // Fixed layout keeps saved mark coordinates identical for every member.
          stagingHost = document.createElement('div')
          Object.assign(stagingHost.style, {
            position: 'fixed', left: '-10000px', top: '0', width: `${SCORE_WIDTH}px`, visibility: 'hidden',
          })
          document.body.appendChild(stagingHost)
          const renderer = new OpenSheetMusicDisplay(stagingHost, {
            autoResize: false, backend: 'svg', pageFormat: 'A4_P',
            drawTitle: true, drawComposer: true, newPageFromXML: true,
          })
          renderer.EngravingRules.RenderMultipleRestMeasures = false
          renderer.EngravingRules.AutoGenerateMultipleRestMeasuresFromRestMeasures = false
          // OSMD detects the ZIP header and unpacks compressed .mxl scores.
          await renderer.load(content, score.title)
          if (cancelled) return
          renderer.render()
          const svgPages = Array.from(stagingHost.querySelectorAll('svg'))
            .filter(svg => !svg.parentElement?.closest('svg'))
          if (svgPages.length === 0) throw new Error('文件中没有可显示的乐谱')
          const pages = svgPages.map(svg => {
            const bounds = svg.getBoundingClientRect()
            const originalWidth = bounds.width || Number.parseFloat(svg.getAttribute('width') || '') || SCORE_WIDTH
            const originalHeight = bounds.height || Number.parseFloat(svg.getAttribute('height') || '') || DEFAULT_HEIGHT
            const height = Math.round(originalHeight * SCORE_WIDTH / originalWidth)
            const copy = svg.cloneNode(true) as SVGSVGElement
            if (!copy.hasAttribute('viewBox')) copy.setAttribute('viewBox', `0 0 ${originalWidth} ${originalHeight}`)
            copy.style.display = 'block'
            copy.style.width = `${SCORE_WIDTH}px`
            copy.style.height = `${height}px`
            return { svg: copy, height }
          })
          if (cancelled) return
          const mapped: MeasureRegion[] = []
          renderer.GraphicSheet.MeasureList.forEach((staves, index) => {
            const visible = staves.filter(measure => measure && !measure.IsExtraGraphicalMeasure && measure.ParentMusicSystem)
            if (!visible.length) return
            const page = visible[0].ParentMusicSystem.Parent
            const pageIndex = renderer.GraphicSheet.MusicPages.indexOf(page)
            const originalWidth = Number.parseFloat(svgPages[pageIndex]?.getAttribute('width') || '') || SCORE_WIDTH
            const unit = 10 * SCORE_WIDTH / originalWidth
            const offset = page.PositionAndShape.AbsolutePosition
            const left = Math.min(...visible.map(m => m.PositionAndShape.AbsolutePosition.x + m.PositionAndShape.BorderLeft)) - offset.x
            const right = Math.max(...visible.map(m => m.PositionAndShape.AbsolutePosition.x + m.PositionAndShape.BorderRight)) - offset.x
            const top = Math.min(...visible.map(m => m.PositionAndShape.AbsolutePosition.y + m.PositionAndShape.BorderTop)) - offset.y
            const bottom = Math.max(...visible.map(m => m.PositionAndShape.AbsolutePosition.y + m.PositionAndShape.BorderBottom)) - offset.y
            if (right > left && bottom > top) mapped.push({ number: timeline[index]?.number || index + 1, page: pageIndex + 1, x: left * unit, y: top * unit, width: (right - left) * unit, height: (bottom - top) * unit })
          })
          setTimeline(score.id, timeline)
          setRegions(score.id, mapped)
          musicPagesRef.current = pages
          musicFileKeyRef.current = fileKey
          setTotalPages(pages.length)
          const page = useAppStore.getState().currentPage
          if (page < 1 || page > pages.length) setCurrentPage(1)
          setMusicRevision(revision => revision + 1)
          setLoading(false)
          stagingHost.remove()
          stagingHost = undefined
        }
      } catch (error) {
        if (cancelled) return
        setRenderError(error instanceof Error ? error.message : '无法读取乐谱文件')
        setLoading(false)
        stagingHost?.remove()
      }
    }
    void loadScore()
    return () => {
      cancelled = true
      controller.abort()
      stagingHost?.remove()
      void pdfTask?.destroy().catch(() => {})
    }
  }, [score.id, score.fileUrl, score.title, isPdf, retryCount, fileKey, setCurrentPage])

  useEffect(() => {
    if (!isPdf || !pdfDocument || pdfDocument.fileKey !== fileKey || !canvasRef.current) return
    let cancelled = false
    let renderTask: RenderTask | undefined
    const canvas = canvasRef.current
    setLoading(true)
    setRenderError(null)

    const renderPage = async () => {
      try {
        const pageNumber = Math.min(pdfDocument.document.numPages, Math.max(1, currentPage))
        const page = await pdfDocument.document.getPage(pageNumber)
        if (cancelled) return
        const baseViewport = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: SCORE_WIDTH / baseViewport.width })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(viewport.width * pixelRatio)
        canvas.height = Math.round(viewport.height * pixelRatio)
        canvas.style.width = `${SCORE_WIDTH}px`
        canvas.style.height = `${viewport.height}px`
        setSurfaceHeight(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器无法创建乐谱画布')
        const renderParameters = {
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        }
        renderTask = page.render(renderParameters)
        await renderTask.promise
        if (!cancelled) {
          setRenderedPageKey(pageKey)
          setLoading(false)
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === 'RenderingCancelledException')) return
        setRenderError(error instanceof Error ? error.message : '当前页无法显示')
        setLoading(false)
      }
    }
    void renderPage()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [isPdf, pdfDocument, currentPage, fileKey, pageKey])

  useEffect(() => {
    const host = musicHostRef.current
    if (!host || isPdf) return
    const page = musicFileKeyRef.current === fileKey ? musicPagesRef.current[currentPage - 1] : undefined
    host.replaceChildren(...(page ? [page.svg] : []))
    if (page) {
      setSurfaceHeight(page.height)
      setRenderedPageKey(pageKey)
    }
  }, [isPdf, currentPage, musicRevision, fileKey, pageKey])

  useEffect(() => {
    const availablePages = isPdf && pdfDocument?.fileKey === fileKey ? pdfDocument.document.numPages
      : musicFileKeyRef.current === fileKey ? musicPagesRef.current.length : 0
    if (!availablePages) return
    const page = Math.min(availablePages, Math.max(1, Math.trunc(currentPage) || 1))
    if (page !== currentPage) setCurrentPage(page)
  }, [isPdf, pdfDocument, fileKey, currentPage, musicRevision, setCurrentPage])

  const clearGesture = useCallback(() => {
    strokeRef.current = null
    setDrawingPath(null)
    setHighlight(null)
  }, [])

  useEffect(() => {
    clearGesture()
    setTextInput(null)
  }, [score.id, currentPage, activeTool, clearGesture])

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, left: 0 })
  }, [score.id, currentPage])

  const pointFromEvent = (event: Pick<ReactPointerEvent, 'clientX' | 'clientY'>): Point | null => {
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) return null
    return {
      x: Math.max(0, Math.min(SCORE_WIDTH, (event.clientX - bounds.left) * SCORE_WIDTH / bounds.width)),
      y: Math.max(0, Math.min(surfaceHeight, (event.clientY - bounds.top) * surfaceHeight / bounds.height)),
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !canAnnotate) return
    const point = pointFromEvent(event)
    if (!point || !currentUser) return
    if (activeTool === 'select' && !aligning) {
      const region = pageRegions.find(region => point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height)
      if (region) {
        setCurrentMeasure(region.number)
        if (isConductor) socket?.emit('current-position', { scoreId: score.id, measure: region.number, beat: 1, running: false })
      }
      return
    }
    event.preventDefault()
    const context: AnnotationContext = {
      scoreId: score.id, page: currentPage, creatorId: currentUser.id,
      targetSection: selectedSection || undefined,
      targetMemberId: selectedMemberId || undefined,
      private: !isConductor,
    }
    if (activeTool === 'text' && !aligning) {
      setTextInput({
        x: Math.min(point.x, SCORE_WIDTH - 240),
        y: Math.min(point.y, Math.max(0, surfaceHeight - 48)),
        value: '', context,
      })
      return
    }
    setTextInput(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    const tool = aligning ? 'layout' : activeTool === 'pen' ? 'pen' : 'highlight'
    strokeRef.current = { pointerId: event.pointerId, tool, points: [point], context }
    if (tool === 'pen') setDrawingPath([point])
    else setHighlight({ ...point, width: 0, height: 0 })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current
    if (!stroke || stroke.pointerId !== event.pointerId) return
    const point = pointFromEvent(event)
    if (!point) return
    event.preventDefault()
    stroke.points.push(point)
    if (stroke.tool === 'pen') setDrawingPath([...stroke.points])
    else setHighlight(rectangleBetween(stroke.points[0], point))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stroke = strokeRef.current
    if (!stroke || stroke.pointerId !== event.pointerId) return
    const point = pointFromEvent(event)
    if (point) stroke.points.push(point)
    if (canAnnotate) {
      if (stroke.tool === 'pen') {
        sendMark({
          ...stroke.context, type: 'DRAWING',
          data: JSON.stringify({ path: stroke.points, color: '#ef4444', width: 2 }),
          x: stroke.points[0].x, y: stroke.points[0].y,
        })
      } else {
        const rectangle = rectangleBetween(stroke.points[0], stroke.points[stroke.points.length - 1])
        if (rectangle.width >= 2 && rectangle.height >= 2) {
          if (stroke.tool === 'layout') {
            setRegions(score.id, [...(regions[score.id] || []).filter(region => !(region.page === currentPage && region.number === alignNumber)), { ...rectangle, page: currentPage, number: alignNumber }])
            setAlignNumber(number => number + 1)
          } else sendMark({ ...stroke.context, type: 'HIGHLIGHT', data: '{}', ...rectangle })
        }
      }
    }
    clearGesture()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleTextSubmit = () => {
    if (!textInput?.value.trim() || !canAnnotate) return
    sendMark({ ...textInput.context, type: 'TEXT', data: textInput.value.trim(), x: textInput.x, y: textInput.y })
    setTextInput(null)
  }

  const handlePageChange = (page: number) => {
    const nextPage = Math.min(totalPages, Math.max(1, page))
    setCurrentPage(nextPage)
    if (isConductor) socket?.emit('page-change', nextPage)
  }

  const saveLayout = async () => {
    if (!currentUser) return
    setSavingLayout(true); setLayoutMessage('')
    try {
      const response = await apiFetch(`/api/scores/${score.id}/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: currentUser.id, regions: regions[score.id] || [] }) })
      if (!response.ok) throw new Error('保存小节位置失败')
      const saved: MeasureRegion[] = await response.json()
      const current = useAppStore.getState().currentScore
      if (current?.id === score.id) useAppStore.getState().setCurrentScore({ ...current, measureRegions: saved })
      socket?.emit('score-select', { scoreId: score.id })
      setLayoutMessage('小节位置已保存并同步')
    } catch (error) { setLayoutMessage(error instanceof Error ? error.message : '保存失败') }
    finally { setSavingLayout(false) }
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
        <button className={`border rounded px-2 py-1 ${fit ? 'bg-blue-50 text-blue-700' : ''}`} onClick={() => setFit(true)}>适合宽度</button>
        <select aria-label="乐谱缩放" className="border rounded p-1" value={fit ? 'fit' : zoom} onChange={e => { if (e.target.value === 'fit') setFit(true); else { setFit(false); setZoom(Number(e.target.value)) } }}><option value="fit">自适应</option>{[.5,.75,1,1.25,1.5,2].map(z => <option value={z} key={z}>{z*100}%</option>)}</select>
        <label className="flex gap-1"><input type="checkbox" checked={showBars} onChange={e => setShowBars(e.target.checked)} />显示小节</label>
        {!isConductor && activeTool !== 'select' && <span className="text-blue-700">我的私密批注</span>}
        {isConductor && isPdf && <details className="relative"><summary className="cursor-pointer border rounded px-2 py-1">PDF 小节定位</summary><div className="absolute z-50 top-8 left-0 bg-white shadow-xl border rounded p-3 w-72 space-y-2">
          <p>框选小节后保存。自动识别结果需检查，复杂总谱可手动调整。</p>
          <label>起始小节 <input aria-label="定位小节号" type="number" min={1} value={alignNumber} className="border rounded w-16 p-1" onChange={e => setAlignNumber(Math.max(1, Number(e.target.value)))} /></label>
          <div className="flex flex-wrap gap-2"><button className="btn-secondary px-2 py-1" disabled={isLoading} onClick={() => { setAligning(value => !value); setShowBars(true) }}>{aligning ? '结束框选' : '手动框选'}</button><button className="btn-secondary px-2 py-1" disabled={isLoading} onClick={() => { const canvas = canvasRef.current; const context = canvas?.getContext('2d'); if (!canvas || !context) return; const detected = detectPdfBars(context.getImageData(0,0,canvas.width,canvas.height), currentPage, alignNumber); setRegions(score.id, [...(regions[score.id] || []).filter(region => region.page !== currentPage), ...detected]); setShowBars(true); setLayoutMessage(detected.length ? `识别 ${detected.length} 个候选小节，请核对编号与位置` : '未识别到可靠小节线，请手动框选') }}>自动识别本页</button></div>
          <button className="btn-primary px-2 py-1" disabled={savingLayout || !isConnected} onClick={() => void saveLayout()}>保存并同步</button><button className="text-red-600 ml-2" onClick={() => setRegions(score.id, (regions[score.id] || []).filter(region => region.page !== currentPage))}>清空本页</button>
          <div className="max-h-24 overflow-auto flex flex-wrap gap-2">{pageRegions.map((region,i) => <button title="删除此小节定位" className="border rounded px-1" key={i} onClick={() => setRegions(score.id, (regions[score.id] || []).filter(item => item !== region))}>{region.number} ×</button>)}</div>
        </div></details>}
        {ownVisibleMarks.length > 0 && <details className="relative"><summary className="cursor-pointer">批注管理 ({ownVisibleMarks.length})</summary><div className="absolute z-50 top-6 right-0 bg-white shadow-xl border p-3 w-64 max-h-64 overflow-auto">{ownVisibleMarks.map(mark => <div className="flex justify-between gap-2 py-2 border-b" key={mark.id}><span className="truncate">{mark.type === 'TEXT' ? mark.data : mark.type === 'DRAWING' ? '手绘标记' : '高亮'}{mark.private ? ' · 私密' : ''}</span><button className="text-red-600" disabled={!isConnected} onClick={() => deleteMark(mark.id)}>删除</button></div>)}</div></details>}
        {layoutMessage && <span role="status" className="text-gray-600">{layoutMessage}</span>}
        {aligning && <span className="text-blue-700">拖动框选第 {alignNumber} 小节</span>}
      </div>
      {isConductor && activeTool !== 'select' && !isConnected && (
        <div role="status" className="bg-yellow-50 text-yellow-800 text-sm px-4 py-2">正在连接排练室，连接恢复后可添加批注。</div>
      )}
      {renderError && (
        <div role="alert" className="bg-red-50 text-red-800 text-sm px-4 py-3 flex items-center justify-between gap-3">
          <span>无法显示乐谱：{renderError}</span>
          <button type="button" onClick={() => setRetryCount(count => count + 1)} className="shrink-0 underline">重新加载</button>
        </div>
      )}
      <div ref={viewportRef} className="flex-1 min-h-0 overflow-auto bg-gray-200 p-4 relative">
        {isLoading && <div role="status" className="sticky left-0 top-0 z-30 bg-white/95 rounded shadow px-4 py-2 w-fit mb-3">正在加载乐谱…</div>}
        <div className="mx-auto" style={{ width: SCORE_WIDTH * scale, height: surfaceHeight * scale }}><div
          ref={surfaceRef}
          aria-label={`${score.title} 第 ${currentPage} 页`}
          className={`bg-white shadow-lg mx-auto relative ${activeTool !== 'select' && canAnnotate ? 'cursor-crosshair' : 'cursor-default'}`}
          style={{ width: SCORE_WIDTH, height: surfaceHeight, transform: `scale(${scale})`, transformOrigin: 'top left', touchAction: (activeTool !== 'select' || aligning) && canAnnotate ? 'none' : 'auto' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={clearGesture}
          onLostPointerCapture={clearGesture}
        >
          {isPdf ? <canvas ref={canvasRef} className="block" /> : <div ref={musicHostRef} />}
          {showBars && !isLoading && <div className="absolute inset-0 pointer-events-none">{pageRegions.map((region,i) => <div key={i} className={`absolute border rounded ${region.number === currentMeasure ? 'border-blue-500 bg-blue-100/20' : 'border-blue-300/30'}`} style={{ left: region.x, top: region.y, width: region.width, height: region.height }}><span className="text-[10px] bg-white/80 text-blue-700 absolute -top-3 left-0">{region.number}</span></div>)}</div>}
          {!isLoading && !renderError && (
            <MarkLayer
              marks={marks} scoreId={score.id} page={currentPage}
              isConductor={isConductor} playerSection={currentUser?.section}
              memberId={currentUser?.id}
              tempDrawingPath={drawingPath} tempHighlight={highlight}
            />
          )}
          {textInput && (
            <div
              className="absolute bg-white shadow-lg rounded p-2 z-50"
              style={{ left: Math.min(textInput.x, SCORE_WIDTH - 260), top: Math.min(textInput.y, Math.max(0, surfaceHeight - 90)) }}
              onPointerDown={event => event.stopPropagation()}
            >
              <input
                type="text" aria-label="批注内容" value={textInput.value} maxLength={1000}
                onChange={event => setTextInput({ ...textInput, value: event.target.value })}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); handleTextSubmit() }
                  if (event.key === 'Escape') setTextInput(null)
                }}
                placeholder="输入批注..." className="border rounded px-2 py-1 text-sm" autoFocus
              />
              <div className="flex gap-1 mt-2">
                <button type="button" onClick={handleTextSubmit} disabled={!canAnnotate || !textInput.value.trim()} className="text-xs bg-primary-500 text-white px-2 py-1 rounded disabled:opacity-40">确定</button>
                <button type="button" onClick={() => setTextInput(null)} className="text-xs bg-gray-200 px-2 py-1 rounded">取消</button>
              </div>
            </div>
          )}
        </div></div>
      </div>
      <PageNavigator currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} disabled={isLoading || !!renderError} />
    </div>
  )
}
