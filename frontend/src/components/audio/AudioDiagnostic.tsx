import { useEffect, useRef, useState } from 'react'
import { checkAudio, type AudioDiagnosticResult } from '../../audio/diagnostic'

export default function AudioDiagnostic() {
  const [busy,setBusy] = useState(false)
  const [status,setStatus] = useState('')
  const [error,setError] = useState('')
  const [result,setResult] = useState<AudioDiagnosticResult | null>(null)
  const mounted=useRef(true)
  const url=useRef('')
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(url.current)URL.revokeObjectURL(url.current)}},[])
  const run=async()=>{
    setBusy(true);setError('');setResult(null)
    if(url.current){URL.revokeObjectURL(url.current);url.current=''}
    try{const next=await checkAudio(value=>{if(mounted.current)setStatus(value)});if(!mounted.current){URL.revokeObjectURL(next.recordingUrl);return};url.current=next.recordingUrl;setResult(next);setStatus(next.signalVerified?'WebRTC 接收与录音自检通过':'音频数据已接收，录音已生成；测试音待确认')}
    catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:'音频自检失败')}
    finally{if(mounted.current)setBusy(false)}
  }
  return <details className="border-t pt-2 text-xs"><summary className="cursor-pointer text-gray-600">浏览器音频自检</summary><p className="mt-2 text-gray-500">生成测试音，检查本机 WebRTC 与录音；无需麦克风权限。</p><button className="border rounded px-2 py-1 mt-2" disabled={busy} onClick={()=>void run()}>{busy?'自检中…':'运行音频自检'}</button>{status&&<p role="status" className="mt-2">{status}</p>}{error&&<p role="alert" className="mt-2 text-red-700">{error}</p>}{result&&<div className="space-y-2 mt-2"><p>本机信号检测 {result.arrivalMs?.toFixed(1)??'—'} ms · 往返 {result.rttMs?.toFixed(1)??'—'} ms</p><p>接收录音 {(result.recordingBytes/1024).toFixed(1)} KB{result.signalVerified?' · 已验证测试信号':''}</p>{result.signalMessage&&<p className="text-amber-700">{result.signalMessage}</p>}<audio aria-label="音频自检录音" controls className="h-8 w-full" src={result.recordingUrl}/><a className="text-blue-700 underline block" href={result.recordingUrl} download="浏览器音频自检录音">下载测试录音</a><p className="text-gray-500">后台采样可能无法测量信号检测时间；本机结果不代表多人网络下的单程音频延迟。</p></div>}</details>
}
