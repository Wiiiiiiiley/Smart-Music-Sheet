export interface AudioDiagnosticResult {
  arrivalMs?: number
  rttMs?: number
  recordingBytes: number
  recordingUrl: string
  signalVerified: boolean
  signalMessage?: string
}

// A generated tone checks the browser's real RTP receive and recording paths without
// accessing the microphone. Both peers run on this device, so this is a local check.
export async function checkAudio(onStatus: (status: string) => void): Promise<AudioDiagnosticResult> {
  if (!globalThis.RTCPeerConnection || !globalThis.MediaRecorder) throw new Error('浏览器缺少 WebRTC 或 MediaRecorder')
  const context = new AudioContext({ latencyHint: 'interactive' })
  const receiveContext = new AudioContext({ latencyHint: 'interactive' })
  const sender = new RTCPeerConnection({ iceServers: [] })
  const receiver = new RTCPeerConnection({ iceServers: [] })
  const source = context.createMediaStreamDestination()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const analyser = receiveContext.createAnalyser()
  analyser.fftSize = 512
  gain.gain.value = .3
  oscillator.frequency.value = 880
  oscillator.connect(gain).connect(source)
  const sourceMonitor = context.createGain()
  sourceMonitor.gain.value = 0
  gain.connect(sourceMonitor).connect(context.destination)
  const candidates: Array<Promise<void>> = []
  const senderPending: RTCIceCandidate[] = []
  const receiverPending: RTCIceCandidate[] = []
  let recorder: MediaRecorder | undefined
  let receivedStream: MediaStream | undefined
  let watch: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let url = ''
  try {
    await context.resume()
    await receiveContext.resume()
    onStatus('建立本机 WebRTC 音频连接…')
    sender.onicecandidate = event => { if (event.candidate) { if (receiver.remoteDescription) candidates.push(receiver.addIceCandidate(event.candidate)); else receiverPending.push(event.candidate) } }
    receiver.onicecandidate = event => { if (event.candidate) { if (sender.remoteDescription) candidates.push(sender.addIceCandidate(event.candidate)); else senderPending.push(event.candidate) } }
    const incoming = new Promise<MediaStream>(resolve => { receiver.ontrack = event => resolve(event.streams[0] || new MediaStream([event.track])) })
    source.stream.getAudioTracks().forEach(track => sender.addTrack(track, source.stream))
    await sender.setLocalDescription(await sender.createOffer())
    await receiver.setRemoteDescription(sender.localDescription!)
    for (const candidate of receiverPending) await receiver.addIceCandidate(candidate)
    await receiver.setLocalDescription(await receiver.createAnswer())
    await sender.setRemoteDescription(receiver.localDescription!)
    for (const candidate of senderPending) await sender.addIceCandidate(candidate)
    receivedStream = await Promise.race([incoming, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('未收到 WebRTC 音频轨道')), 10_000) })])
    clearTimeout(timeout)
    const streamSource = receiveContext.createMediaStreamSource(receivedStream)
    const silentMonitor = receiveContext.createGain()
    silentMonitor.gain.value = 0
    streamSource.connect(analyser).connect(silentMonitor).connect(receiveContext.destination)
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('本机音频连接超时')), 10_000)
      receiver.onconnectionstatechange = () => {
        if (receiver.connectionState === 'connected') { clearTimeout(timeout); resolve() }
        if (receiver.connectionState === 'failed') { clearTimeout(timeout); reject(new Error('WebRTC 本机连接失败')) }
      }
      if (receiver.connectionState === 'connected') { clearTimeout(timeout); resolve() }
    })
    await Promise.all(candidates)
    onStatus('发送测试信号并录制接收音频…')
    const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
    recorder = new MediaRecorder(receivedStream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    const recorded = new Promise<Blob>((resolve,reject) => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder!.onstop = () => resolve(new Blob(chunks,{ type: recorder!.mimeType }))
      recorder!.onerror = () => reject(new Error('测试音频录制失败'))
    })
    recorder.start()
    const delay = .12
    const sentAt = performance.now() + delay * 1000
    oscillator.start(context.currentTime + delay)
    // Background tabs may throttle sampling timers to one second. Keep the
    // signal active long enough to verify it without requiring a visible tab.
    oscillator.stop(context.currentTime + delay + 2)
    const arrivalMs = await new Promise<number | undefined>(resolve => {
      const samples = new Float32Array(analyser.fftSize)
      timeout = setTimeout(() => {
        clearInterval(watch)
        resolve(undefined)
      }, 4000)
      watch = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum,sample) => sum+sample*sample,0)/samples.length)
        if (rms > .025) { clearInterval(watch); clearTimeout(timeout); resolve(Math.max(0,performance.now()-sentAt)) }
      }, 5)
    })
    await new Promise(resolve => setTimeout(resolve, 700))
    recorder.stop()
    const blob = await recorded
    if (blob.size < 100) throw new Error('录音文件没有有效音频')
    onStatus('检查接收录音中的测试信号…')
    let signalVerified = false
    let signalMessage: string | undefined
    try {
      const decoded = await receiveContext.decodeAudioData(await blob.arrayBuffer())
      const pcm = decoded.getChannelData(0)
      const rms = Math.sqrt(pcm.reduce((sum,sample)=>sum+sample*sample,0)/pcm.length)
      signalVerified = rms >= .005
      if (!signalVerified) signalMessage = '接收录音未检测到测试音，请在前台重试并检查下方录音。'
    } catch {
      signalMessage = '浏览器无法自动解码此录音格式，请播放下方录音检查测试音。'
    }
    const receivedStats = await receiver.getStats()
    let receivedPackets = 0
    receivedStats.forEach(report => { if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) receivedPackets += report.packetsReceived || 0 })
    if (!receivedPackets) throw new Error('WebRTC 未收到音频数据包')
    let rttMs: number | undefined
    const stats = await sender.getStats()
    stats.forEach(report => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated && Number.isFinite(report.currentRoundTripTime)) rttMs = report.currentRoundTripTime * 1000 })
    url = URL.createObjectURL(blob)
    return { arrivalMs, rttMs, recordingBytes: blob.size, recordingUrl: url, signalVerified, signalMessage }
  } finally {
    clearTimeout(timeout); clearInterval(watch)
    if (recorder?.state === 'recording') recorder.stop()
    sender.close(); receiver.close()
    source.stream.getTracks().forEach(track => track.stop())
    receivedStream?.getTracks().forEach(track => track.stop())
    try { oscillator.stop() } catch { /* It may already have ended. */ }
    await context.close()
    await receiveContext.close()
  }
}
