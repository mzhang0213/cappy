import { useRef, useEffect, useState } from 'react'
import './App.css'
import cappyImg from './assets/cappy.png'
import marioFrameImg from './assets/mario_frame.png'
import { useHls } from './useHls'

// Browsers expose media-element capture under different (partly untyped) names.
type Capturable = HTMLVideoElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

// Root route: watch the live broadcast, and optionally record what's playing
// (video + audio) to a file on this machine.
function Viewer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { attach, detach } = useHls(videoRef)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [recStatus, setRecStatus] = useState('')

  useEffect(() => {
    attach()
    return () => detach()
  }, [attach, detach])

  function startRecording() {
    const video = videoRef.current as Capturable | null
    if (!video) return

    const capture = video.captureStream?.bind(video) ?? video.mozCaptureStream?.bind(video)
    if (!capture) {
      setRecStatus('Recording not supported in this browser.')
      return
    }
    const stream = capture()
    if (stream.getTracks().length === 0) {
      setRecStatus('Nothing playing yet — wait for the stream to start.')
      return
    }

    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m))

    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunksRef.current = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' })
      chunksRef.current = []
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`
      a.click()
      URL.revokeObjectURL(url)
      setRecStatus('Saved.')
    }

    rec.start(1000) // flush a chunk every second
    recorderRef.current = rec
    setRecording(true)
    const hasAudio = stream.getAudioTracks().length > 0
    setRecStatus(hasAudio ? 'Recording (with audio)…' : 'Recording (no audio track)…')
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  return (
    <div className="body-container">
      <h2>Live Screen (HLS)</h2>
      <div className="frame-container">
        <div className="player-container">
          <img src={cappyImg} className="cappy" alt="Cappy" style={{ visibility: 'hidden' }} />
          <div className="frame-overlay" style={{ visibility: 'hidden' }}>
            <img src={marioFrameImg} alt="Mario Frame" />
          </div>
          <video ref={videoRef} id="vid" autoPlay playsInline muted></video>
        </div>
      </div>

      <div className="controls">
        <div className="buttons">
          <button onClick={startRecording} disabled={recording}>
            Record
          </button>
          <button onClick={stopRecording} disabled={!recording}>
            Stop
          </button>
        </div>
        {recStatus && <p className="status">{recStatus}</p>}
      </div>
    </div>
  )
}

export default Viewer
