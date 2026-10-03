import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, Music, FileText, X, Check } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { apiFetch } from '../utils/api'

export default function ScoreUploadPage() {
  const navigate = useNavigate()
  const { currentEnsemble, setCurrentEnsemble, setCurrentScore } = useAppStore()
  
  const [title, setTitle] = useState('')
  const [composer, setComposer] = useState('')
  const [scoreFile, setScoreFile] = useState<File | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentEnsemble) navigate('/setup', { replace: true })
  }, [currentEnsemble, navigate])

  const selectScoreFile = useCallback((file: File) => {
    if (!/\.(pdf|xml|musicxml|mxl)$/i.test(file.name)) {
      setError('请选择 PDF 或 MusicXML 乐谱文件')
      return
    }
    setError('')
    setScoreFile(file)
  }, [])

  const onDropScore = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) selectScoreFile(file)
  }, [selectScoreFile])

  const onDropAudio = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('audio/')) {
      setAudioFile(file)
    }
  }, [])

  const handleScoreFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) selectScoreFile(file)
  }

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setAudioFile(file)
  }

  const handleUpload = async () => {
    if (!title.trim() || !scoreFile || !currentEnsemble) return

    setIsUploading(true)
    setUploadProgress(0)
    setError('')

    try {
      // 上传文件
      const formData = new FormData()
      formData.append('score', scoreFile)
      if (audioFile) formData.append('audio', audioFile)

      const uploadResponse = await apiFetch('/api/upload/both', {
        method: 'POST',
        body: formData
      })

      if (!uploadResponse.ok) throw new Error('文件上传失败')

      const uploadResult = await uploadResponse.json()
      if (!uploadResult.score?.fileUrl) throw new Error('服务器未返回乐谱文件地址')
      setUploadProgress(65)

      // 创建乐谱记录
      const scoreResponse = await apiFetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          composer: composer.trim() || undefined,
          fileUrl: uploadResult.score.fileUrl,
          fileType: uploadResult.score.fileType,
          audioUrl: uploadResult.audio?.fileUrl,
          ensembleId: currentEnsemble.id
        })
      })

      if (!scoreResponse.ok) throw new Error('创建乐谱失败')

      const score = await scoreResponse.json()
      setCurrentScore({ ...score, marks: score.marks || [], measures: score.measures || [] })
      setCurrentEnsemble({
        ...currentEnsemble,
        scores: [score, ...currentEnsemble.scores.filter((existing) => existing.id !== score.id)],
      })
      setUploadProgress(100)

      // 跳转到乐谱页面
      navigate(`/conductor/score/${score.id}`)
    } catch (error) {
      console.error('上传失败:', error)
      setError(error instanceof Error ? error.message : '上传失败，请重试')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="min-h-full flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 h-14 flex items-center">
        <button 
          onClick={() => navigate('/conductor')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-5 h-5" />
          返回
        </button>
        <h1 className="ml-4 font-semibold text-gray-900">上传乐谱</h1>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 max-w-2xl mx-auto w-full">
        <div className="panel p-6 space-y-6">
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {/* 曲目信息 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                曲目名称 *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：贝多芬第九交响曲"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                作曲家
              </label>
              <input
                type="text"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="例如：贝多芬"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* 乐谱文件上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              乐谱文件 *
            </label>
            {scoreFile ? (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                <FileText className="w-8 h-8 text-blue-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{scoreFile.name}</p>
                  <p className="text-sm text-gray-500">{(scoreFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button
                  onClick={() => setScoreFile(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div
                onDrop={onDropScore}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-500 transition-colors"
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 mb-2">拖拽 PDF 或 MusicXML 文件到此处</p>
                <p className="text-sm text-gray-500 mb-4">或</p>
                <label className="btn-secondary inline-block cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf,.xml,.musicxml,.mxl,application/pdf,application/vnd.recordare.musicxml"
                    onChange={handleScoreFileChange}
                    className="hidden"
                  />
                  选择文件
                </label>
              </div>
            )}
          </div>

          {/* 音频文件上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              参考音频（可选）
            </label>
            {audioFile ? (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                <Music className="w-8 h-8 text-green-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{audioFile.name}</p>
                  <p className="text-sm text-gray-500">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button
                  onClick={() => setAudioFile(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div
                onDrop={onDropAudio}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-500 transition-colors"
              >
                <Music className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 mb-2">拖拽音频文件到此处</p>
                <p className="text-sm text-gray-500 mb-4">MP3, WAV, OGG 格式</p>
                <label className="btn-secondary inline-block cursor-pointer">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileChange}
                    className="hidden"
                  />
                  选择文件
                </label>
              </div>
            )}
          </div>

          {/* 上传进度 */}
          {isUploading && (
            <div className="space-y-2">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-sm text-gray-600 text-center">上传中...</p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={() => navigate('/conductor')}
              className="flex-1 btn-secondary"
              disabled={isUploading}
            >
              取消
            </button>
            <button
              onClick={handleUpload}
              disabled={!title.trim() || !scoreFile || !currentEnsemble || isUploading}
              className="flex-1 btn-conductor flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  上传中...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  确认上传
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
