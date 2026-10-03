export interface RealtimeSocket {
  readonly connected: boolean
  readonly id?: string
  on(event: string, callback: (data?: any) => void): unknown
  off(event: string, callback?: (data?: any) => void): unknown
  emit(event: string, data?: any): unknown
  disconnect(): unknown
}

// The Worker uses plain WebSocket event envelopes; Express uses Socket.IO.
export class WorkerSocket implements RealtimeSocket {
  connected = false
  id?: string
  private ws?: WebSocket
  private listeners = new Map<string, Set<(data?: any) => void>>()
  private joinData?: { ensembleId: string; memberId: string }
  private audioData?: any
  private timer?: ReturnType<typeof setTimeout>
  private retries = 0
  private stopped = false

  constructor(private url: string) {}

  on(event: string, callback: (data?: any) => void) {
    const callbacks = this.listeners.get(event) || new Set()
    callbacks.add(callback)
    this.listeners.set(event, callbacks)
    return this
  }

  off(event: string, callback?: (data?: any) => void) {
    if (callback) this.listeners.get(event)?.delete(callback)
    else this.listeners.delete(event)
    return this
  }

  private dispatch(event: string, data?: any) {
    for (const callback of this.listeners.get(event) || []) callback(data)
  }

  private open() {
    this.timer = undefined
    if (!this.joinData || this.stopped) return
    const url = new URL(this.url)
    url.searchParams.set('ensembleId', this.joinData.ensembleId)
    url.searchParams.set('userId', this.joinData.memberId)
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onmessage = ({ data }) => {
      if (ws !== this.ws) return
      try {
        const message = JSON.parse(data)
        if (message.event === 'connected') {
          this.id = message.data.socketId
          this.connected = true
          this.retries = 0
          ws.send(JSON.stringify({ event: 'join-ensemble', data: this.joinData }))
          if (this.audioData) ws.send(JSON.stringify({ event: 'join-audio-room', data: this.audioData }))
          this.dispatch('connect')
        } else this.dispatch(message.event, message.data)
      } catch {
        this.dispatch('error', { message: '实时消息解析失败' })
      }
    }
    ws.onerror = () => { if (ws === this.ws) this.dispatch('connect_error', { message: '实时连接失败，请检查后端地址和服务状态' }) }
    ws.onclose = () => {
      if (ws !== this.ws) return
      this.connected = false
      this.id = undefined
      this.dispatch('disconnect')
      if (!this.stopped && this.retries < 5) {
        this.timer = setTimeout(() => this.open(), Math.min(1000 * 2 ** this.retries++, 10000))
      }
    }
  }

  emit(event: string, data?: any) {
    if (event === 'join-ensemble') {
      const changed = this.joinData &&
        (this.joinData.ensembleId !== data.ensembleId || this.joinData.memberId !== data.memberId)
      this.joinData = data
      if (changed) {
        if (this.ws) this.ws.onclose = null
        this.ws?.close()
        this.connected = false
        this.open()
        return this
      }
      if (!this.ws && !this.timer) this.open()
    }
    if (event === 'leave-ensemble') {
      this.joinData = undefined
      this.audioData = undefined
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event, data }))
      }
      if (this.ws) this.ws.onclose = null
      this.ws?.close()
      this.ws = undefined
      clearTimeout(this.timer)
      this.timer = undefined
      this.connected = false
      this.id = undefined
      this.dispatch('disconnect')
      return this
    }
    if (event === 'join-audio-room') this.audioData = data
    if (event === 'leave-audio-room') this.audioData = undefined
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }))
    } else if (!['join-ensemble', 'join-audio-room'].includes(event)) {
      this.dispatch('error', { message: '尚未连接到乐团，请连接后重试' })
    }
    return this
  }

  disconnect() {
    this.stopped = true
    clearTimeout(this.timer)
    this.ws?.close()
    this.connected = false
    this.listeners.clear()
    return this
  }
}
