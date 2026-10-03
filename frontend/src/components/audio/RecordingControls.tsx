import { useEffect, useRef, useState } from 'react'
import { Circle, Square, Download } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { apiFetch, resolveAssetUrl } from '../../utils/api'
import { audioEngine } from '../../audio/audioEngine'

export default function RecordingControls() {
  const { currentRehearsalId, currentUser, isRehearsing } = useAppStore()
  const recorder = useRef<MediaRecorder>()
  const sessionId = useRef<string>()
  const chunks = useRef<Blob[]>([])
  const size = useRef(0)
  const mounted = useRef(true)
  const localUrl = useRef('')
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (recorder.current?.state === 'recording') recorder.current.stop()
      audioEngine.releaseMicrophone('recording')
      if (localUrl.current) URL.revokeObjectURL(localUrl.current)
    }
  }, [])

  useEffect(() => { if (!isRehearsing && recorder.current?.state === 'recording') recorder.current.stop() }, [isRehearsing])

  const start = async () => {
    if (!currentRehearsalId || !currentUser || saving) return
    setError('')
    setSaving(true)
    try {
      if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持录音，请使用新版浏览器')
      sessionId.current = currentRehearsalId
      await audioEngine.microphone('recording')
      if (!mounted.current || !useAppStore.getState().isRehearsing) { audioEngine.releaseMicrophone('recording'); return }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value))
      const next = new MediaRecorder(audioEngine.recordingStream(), mime ? { mimeType: mime, audioBitsPerSecond: 96000 } : undefined)
      chunks.current = []
      size.current = 0
      recorder.current = next
      next.ondataavailable = event => {
        if (!event.data.size) return
        chunks.current.push(event.data)
        size.current += event.data.size
        if (size.current > 48 * 1024 * 1024 && next.state === 'recording') next.stop()
      }
      next.onerror = () => { if (mounted.current) setError('录音中断，已有片段将尝试保存') }
      next.onstop = () => {
        audioEngine.releaseMicrophone('recording')
        if (mounted.current) { setRecording(false); setSaving(true) }
        const blob = new Blob(chunks.current, { type: next.mimeType || 'audio/webm' })
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
        const previousUrl = localUrl.current
        localUrl.current = mounted.current ? URL.createObjectURL(blob) : ''
        if (previousUrl) URL.revokeObjectURL(previousUrl)
        if (mounted.current) setUrl(localUrl.current)
        const body = new FormData()
        body.append('audio', blob, `排练录音-${sessionId.current}.${extension}`)
        void apiFetch('/api/upload/audio', { method: 'POST', body }).then(async response => {
          if (!response.ok) throw new Error('录音上传失败，可以先下载本地录音')
          const uploaded = await response.json() as { fileUrl: string }
          const saved = await apiFetch(`/api/rehearsals/${sessionId.current}/recording`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memberId: currentUser.id, recordingUrl: uploaded.fileUrl }),
          })
          if (!saved.ok) throw new Error('录音关联排练失败，可以先下载本地录音')
          if (mounted.current) setUrl(resolveAssetUrl(uploaded.fileUrl))
        }).catch(failure => { if (mounted.current) setError(failure instanceof Error ? failure.message : '录音保存失败') })
          .finally(() => { if (mounted.current) setSaving(false) })
      }
      next.start(1000)
      setRecording(true)
      void apiFetch(`/api/rehearsals/${sessionId.current}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: currentUser.id, type: 'RECORDING_STARTED', data: { recordingStartedAt: new Date().toISOString() } }),
      }).then(response => {
        if (!response.ok && mounted.current) setError('录音已开启，但复盘时间定位保存失败')
      }).catch(() => { if (mounted.current) setError('录音已开启，但复盘时间定位保存失败') })
    } catch (failure) {
      audioEngine.releaseMicrophone('recording')
      setError(failure instanceof Error ? failure.message : '无法启用录音')
    } finally { if (mounted.current) setSaving(false) }
  }

  return <div className="mt-3 space-y-2">
    <button disabled={saving || (!recording && !currentRehearsalId)} onClick={recording ? () => recorder.current?.stop() : () => void start()} className="w-full border px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-50">
      {recording ? <Square className="w-4 h-4 text-red-600" /> : <Circle className="w-4 h-4 text-red-600" />}
      {saving ? '保存录音中…' : recording ? '停止并保存录音' : '录制排练'}
    </button>
    <p className="text-xs text-gray-500">记录指挥麦克风与本机播放的提示、参考音轨。约 48 MB 时自动保存。</p>
    {url && <><audio controls className="w-full h-9" src={url} /><a href={url} download="排练录音" className="text-xs text-primary-600 inline-flex items-center gap-1"><Download className="w-3 h-3" />下载录音</a></>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>
}
