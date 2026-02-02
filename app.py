from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

app = FastAPI()

BASE_DIR = Path(__file__).parent

# Serve HLS segments
app.mount("/hls", StaticFiles(directory=BASE_DIR / "hls"), name="hls")

# Serve player.html at root
@app.get("/", response_class=HTMLResponse)
def root():
    return (BASE_DIR / "player.html").read_text()



'''
ffmpeg -hide_banner -loglevel info \
  -f avfoundation -framerate 30 -i "0:none" \
  -fflags +genpts -use_wallclock_as_timestamps 1 \
  -vsync cfr -r 30 \
  -vf "scale=1280:-2,format=yuv420p" \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -f hls -hls_time 2 -hls_list_size 6 \
  -hls_flags delete_segments+append_list \
  hls/stream.m3u8


SIMULTANEOUS
ffmpeg -hide_banner -loglevel info \
  -f avfoundation -framerate 30 -i "4:none" \
  -f avfoundation -framerate 30 -video_size 1280x720 -i "0:none" \
  -fflags +genpts -use_wallclock_as_timestamps 1 \
  -fps_mode cfr -r 15 \
  -filter_complex "\
    [0:v]fps=15,scale=1280:-2,format=yuv420p[screen]; \
    [1:v]fps=15,scale=320:-2,format=yuv420p[cam]; \
    [screen][cam]overlay=W-w-20:H-h-20[out] \
  " \
  -map "[out]" \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -g 30 -keyint_min 30 -sc_threshold 0 \
  -f hls -hls_time 2 -hls_list_size 6 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "hls/seg_%05d.ts" \
  hls/stream.m3u8



  
TEST CMD
  ffmpeg -hide_banner -loglevel verbose \
  -f avfoundation -framerate 30 -i "4:none" \
  -t 5 -c:v h264 test.mp4

SERVER
uvicorn app:app --host 0.0.0.0 --port 3777

LIST
ffmpeg -hide_banner -loglevel info \
  -f avfoundation -list_devices true -i ""


TUNNEL
cloudflared tunnel run --token eyJhIjoiYjEwM2FlMDM1ODAwYWE5NjVjZWQyYWY2NWExNzlkOTgiLCJ0IjoiY2I1ODVlYzktNTgwNS00ZDdhLTgzYTctM2RhMTE2MGUyNjM3IiwicyI6IlpXVTRObUppTVdFdFpqQm1OaTAwT0RkaUxXRm1PVEF0Tm1Nd05tVTFPV0ZoWWpZeiJ9

'''