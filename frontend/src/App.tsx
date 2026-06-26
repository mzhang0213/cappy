import { useRef, useEffect } from 'react'
import './App.css'
import cappyImg from './assets/cappy.png'
import marioFrameImg from './assets/mario_frame.png'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleError = () => {
      console.log("Video error or stalled, attempting to reload...");
      setTimeout(() => {
        if (video) {
          video.load();
          video.play().catch(() => {
            // Ignore autoplay blocks
          });
        }
      }, 2000);
    };

    video.addEventListener('error', handleError);
    video.addEventListener('stalled', handleError);

    return () => {
      video.removeEventListener('error', handleError);
      video.removeEventListener('stalled', handleError);
    };
  }, []);

  const handlePlay = async () => {
    try {
      // Example call to start_video when play is clicked
      // In a real scenario, you'd pass the actual device IDs
      await fetch('/server/start_video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 1, device_ids: [4,0] })
      });
    } catch (e) {
      console.error("Failed to start video:", e);
    }

    if (videoRef.current) {
      await videoRef.current.play();
    }
  };

  return (
    <div className="body-container">
      <h2>Live Screen (HLS)</h2>
      <div className="frame-container">
        {/*<div className="frame-overlay">*/}
        {/*  <img src={marioFrameImg} alt="Mario Frame" />*/}
        {/*</div>*/}

        <div className="player-container">
          <img src={cappyImg} className="cappy" alt="Cappy" />
          <video
            ref={videoRef}
            id="vid"
            autoPlay
            playsInline
            muted
            src="/hls/stream.m3u8"
          ></video>
        </div>
      </div>

      <p>If it doesn’t auto-play, tap play.</p>
      <div className="controls">
        <button onClick={handlePlay}>Play</button>
      </div>
    </div>
  )
}

export default App
