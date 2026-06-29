import { useRef, useEffect, useState, useCallback } from 'react'
import Hls from 'hls.js'
import './App.css'
import cappyImg from './assets/cappy.png'
import marioFrameImg from './assets/mario_frame.png'

type Device = { index: number; name: string }
const STREAM_URL = '/hls/stream.m3u8'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const liveTimerRef = useRef<number | null>(null)

  const [devices, setDevices] = useState<Device[]>([])
  const [mode, setMode] = useState<0 | 1>(0) // 0 = single, 1 = layered
  const [screenId, setScreenId] = useState<number | null>(null)
  const [camId, setCamId] = useState<number | null>(null)
  const [status, setStatus] = useState('Idle')
  const [playing, setPlaying] = useState(false)
  const [showDecor, setShowDecor] = useState(true) // cappy + mario frame overlay

  // Load available capture devices so the user picks real indices.
  useEffect(() => {
    fetch('/server/devices')
      .then((r) => r.json())
      .then((data: { devices: Device[] }) => {
        const devs = data.devices ?? []
        setDevices(devs)
        if (devs[0]) setScreenId(devs[0].index)
        if (devs[1]) setCamId(devs[1].index)
      })
      .catch((e) => {
        console.error('Failed to load devices:', e)
        setStatus('Could not reach backend — is it running?')
      })
  }, [])

  const stopLiveWatchdog = useCallback(() => {
    if (liveTimerRef.current != null) {
      clearInterval(liveTimerRef.current)
      liveTimerRef.current = null
    }
  }, [])

  // Attach the HLS playlist to the <video>, using hls.js where the browser
  // can't play HLS natively (i.e. everything except Safari).
  const attachStream = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    hlsRef.current?.destroy()
    hlsRef.current = null
    stopLiveWatchdog()

    if (Hls.isSupported()) {
      const hls = new Hls({ liveDurationInfinity: true })
      hlsRef.current = hls
      hls.loadSource(STREAM_URL)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return
        console.warn('HLS fatal error:', data.type, data.details)
        // Recover without tearing playback down. No seeking here — that was
        // what caused the jump/loop.
        if (
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
          data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR
        ) {
          // Playlist isn't ready yet (the 404 right after ffmpeg starts).
          // startLoad() won't re-fetch the manifest, so reload the source.
          setTimeout(() => hlsRef.current?.loadSource(STREAM_URL), 1000)
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad()
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else {
          setTimeout(attachStream, 1000)
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari: native HLS.
      video.src = STREAM_URL
      video.play().catch(() => {})
    } else {
      setStatus('This browser cannot play HLS.')
    }
  }, [stopLiveWatchdog])

  useEffect(() => {
    // Clean up on unmount.
    return () => {
      stopLiveWatchdog()
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [stopLiveWatchdog])

  const handlePlay = async () => {
    if (screenId == null) {
      setStatus('Pick a screen device first.')
      return
    }
    const device_ids = mode === 1 ? [screenId, camId ?? screenId] : [screenId]

    try {
      setStatus('Starting ffmpeg…')
      const res = await fetch('/server/start_video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mode, device_ids }),
      })
      const data = await res.json()
      if (data.status !== 'started') {
        setStatus(`Start failed: ${data.message ?? 'unknown error'}`)
        return
      }
      setStatus('Buffering…')
      setPlaying(true)
      // Give ffmpeg a moment to write the first segment, then attach.
      setTimeout(attachStream, 1500)
      setTimeout(() => setStatus('Live'), 3000)
    } catch (e) {
      console.error('Failed to start video:', e)
      setStatus('Failed to start video.')
    }
  }

  const handleStop = async () => {
    try {
      await fetch('/server/stop_video', { method: 'POST' })
    } catch (e) {
      console.error('Failed to stop video:', e)
    }
    stopLiveWatchdog()
    hlsRef.current?.destroy()
    hlsRef.current = null
    if (videoRef.current) videoRef.current.removeAttribute('src')
    setPlaying(false)
    setStatus('Stopped')
  }

  return (
    <div className="body-container">
      <h2>Live Screen (HLS)</h2>
      <div className="frame-container">
        <div className="player-container">
          {showDecor && (
            <>
              <img src={cappyImg} className="cappy" alt="Cappy" style={{visibility:"hidden"}}/>
              <div className="frame-overlay" style={{visibility:"hidden"}}>
                <img src={marioFrameImg} alt="Mario Frame" />
              </div>
            </>
          )}
          <video ref={videoRef} id="vid" autoPlay playsInline muted></video>
        </div>
      </div>

      <div className="controls">
        <div className="settings">
          <label>
            Mode:{' '}
            <select value={mode} onChange={(e) => setMode(Number(e.target.value) as 0 | 1)}>
              <option value={0}>Single</option>
              <option value={1}>Layered (screen + cam)</option>
            </select>
          </label>

          <label>
            Screen:{' '}
            <select
              value={screenId ?? ''}
              onChange={(e) => setScreenId(Number(e.target.value))}
            >
              {devices.map((d) => (
                <option key={d.index} value={d.index}>
                  [{d.index}] {d.name}
                </option>
              ))}
            </select>
          </label>

          {mode === 1 && (
            <label>
              Camera:{' '}
              <select
                value={camId ?? ''}
                onChange={(e) => setCamId(Number(e.target.value))}
              >
                {devices.map((d) => (
                  <option key={d.index} value={d.index}>
                    [{d.index}] {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="toggle">
            <input
              type="checkbox"
              checked={showDecor}
              onChange={(e) => setShowDecor(e.target.checked)}
            />{' '}
            Show Mario/Cappy
          </label>
        </div>

        <div className="buttons">
          <button onClick={handlePlay} disabled={playing}>
            Play
          </button>
          <button onClick={handleStop} disabled={!playing}>
            Stop
          </button>
        </div>
        <p className="status">Status: {status}</p>
      </div>
    </div>
  )
}

export default App
