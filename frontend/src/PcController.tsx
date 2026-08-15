import { useRef, useEffect, useState } from 'react'
import './App.css'
import cappyImg from './assets/cappy.png'
import marioFrameImg from './assets/mario_frame.png'
import { useHls } from './useHls'

type Device = { index: number; name: string }

// /pc route: the original operator screen — capture local avfoundation
// devices via the backend and stream them out as HLS.
function PcController() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { attach, detach } = useHls(videoRef)

  const [devices, setDevices] = useState<Device[]>([])
  const [mode, setMode] = useState<0 | 1>(0) // 0 = single, 1 = layered
  const [screenId, setScreenId] = useState<number | null>(null)
  const [camId, setCamId] = useState<number | null>(null)
  const [status, setStatus] = useState('Idle')
  const [playing, setPlaying] = useState(false)
  const [showDecor] = useState(true) // cappy + mario frame overlay (toggle is commented out below)

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
      setTimeout(attach, 1500)
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
    detach()
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

          {/*<label className="toggle">*/}
          {/*  <input*/}
          {/*    type="checkbox"*/}
          {/*    checked={showDecor}*/}
          {/*    onChange={(e) => setShowDecor(e.target.checked)}*/}
          {/*  />{' '}*/}
          {/*  Show Mario/Cappy*/}
          {/*</label>*/}
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

export default PcController
