import { useRef, useCallback, useEffect, type RefObject } from 'react'
import Hls from 'hls.js'

const STREAM_URL = '/hls/stream.m3u8'

// Attach the HLS playlist to a <video>, using hls.js where the browser can't
// play HLS natively (i.e. everything except Safari). Shared by the Viewer and
// the PC controller so the fiddly error-recovery lives in one place.
export function useHls(videoRef: RefObject<HTMLVideoElement | null>) {
  const hlsRef = useRef<Hls | null>(null)
  const liveTimerRef = useRef<number | null>(null)

  const stopLiveWatchdog = useCallback(() => {
    if (liveTimerRef.current != null) {
      clearInterval(liveTimerRef.current)
      liveTimerRef.current = null
    }
  }, [])

  const attach = useCallback(() => {
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
          setTimeout(attach, 1000)
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari: native HLS.
      video.src = STREAM_URL
      video.play().catch(() => {})
    } else {
      console.warn('This browser cannot play HLS.')
    }
  }, [videoRef, stopLiveWatchdog])

  const detach = useCallback(() => {
    stopLiveWatchdog()
    hlsRef.current?.destroy()
    hlsRef.current = null
  }, [stopLiveWatchdog])

  useEffect(() => {
    // Clean up on unmount.
    return () => {
      stopLiveWatchdog()
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [stopLiveWatchdog])

  return { attach, detach }
}
