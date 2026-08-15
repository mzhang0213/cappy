import { useRef, useState } from 'react'
import './App.css'

// /host route: capture this browser's screen (with audio when available) and
// push it to the backend over a WebSocket, which transcodes it to the same HLS
// stream the viewers at / are watching.
function Host() {
  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState('Idle')

  function stop() {
    const rec = recorderRef.current
    recorderRef.current = null
    if (rec && rec.state !== 'inactive') rec.stop()

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    wsRef.current?.close()
    wsRef.current = null

    if (previewRef.current) previewRef.current.srcObject = null
    setSharing(false)
    setStatus('Stopped')
  }

  async function start() {
    try {
      // Requires a user gesture (this click) and a secure context
      // (HTTPS or localhost).
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      streamRef.current = stream
      if (previewRef.current) previewRef.current.srcObject = stream

      // Confirm whether the platform actually handed us an audio track.
      // On macOS this only happens for a Chrome tab with "Share tab audio".
      const audioTracks = stream.getAudioTracks()
      const hasAudio = audioTracks.length > 0
      console.log('screenshare audio tracks:', audioTracks.map((t) => t.label))

      // Tear down if the user ends the share from the browser's own UI.
      stream.getVideoTracks()[0].addEventListener('ended', stop)

      // VP8 first: lighter to encode in the browser and lighter for ffmpeg
      // to decode than VP9 (we re-encode to H264 anyway, so VP9's better
      // compression buys us nothing over a local WebSocket hop).
      const mimeType = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
      ].find((m) => MediaRecorder.isTypeSupported(m))

      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/server/ws_host`)
      wsRef.current = ws

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
      }

      ws.onopen = () => {
        recorder.start(1000) // emit a chunk every second
        setSharing(true)
        setStatus(
          hasAudio
            ? 'Live — sharing screen + audio'
            : 'Live — screen only (no audio track; on macOS, share a Chrome tab with "Share tab audio")',
        )
      }
      ws.onerror = () => setStatus('WebSocket error — is the backend running?')
      ws.onclose = () => {
        // Socket dropped while still sharing — clean up.
        if (recorderRef.current) stop()
      }
    } catch (e) {
      console.error('Failed to start screen share:', e)
      setStatus('Screen share canceled or blocked.')
    }
  }

  return (
    <div className="body-container">
      <h2>Host — Share your screen</h2>
      <div className="frame-container">
        <div className="player-container">
          <video ref={previewRef} autoPlay playsInline muted></video>
        </div>
      </div>

      <div className="controls">
        <div className="buttons">
          <button onClick={start} disabled={sharing}>
            Start sharing
          </button>
          <button onClick={stop} disabled={!sharing}>
            Stop
          </button>
        </div>
        <p className="status">Status: {status}</p>
      </div>
    </div>
  )
}

export default Host
