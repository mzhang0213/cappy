import re
import subprocess
from typing import List
import shlex

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path


class HLSStaticFiles(StaticFiles):
    """Static file server that never lets the live playlist be cached.

    The HLS playlist (stream.m3u8) is rewritten by ffmpeg every couple of
    seconds. If it's served with Last-Modified/ETag and no Cache-Control, the
    browser caches it and serves hls.js's playlist re-fetches straight from its
    own HTTP cache — those requests never reach the backend, so the player keeps
    seeing a stale segment list and stops loading new segments. Force the
    playlist to always be revalidated against the server.
    """

    async def get_response(self, path, scope):
        if path.endswith(".m3u8"):
            # Drop conditional-request headers so we never answer 304 for the
            # live playlist, and strip any caching of it.
            scope = dict(scope)
            scope["headers"] = [
                (k, v) for (k, v) in scope["headers"]
                if k.lower() not in (b"if-modified-since", b"if-none-match")
            ]
        response = await super().get_response(path, scope)
        if path.endswith(".m3u8"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            for h in ("etag", "last-modified"):
                if h in response.headers:
                    del response.headers[h]
        return response

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
HLS_DIR = BASE_DIR / "hls"

# Make sure the HLS output directory exists before mounting it, otherwise
# StaticFiles raises at startup and the server never comes up.
HLS_DIR.mkdir(exist_ok=True)

# Serve HLS segments (playlist served with no-cache; see HLSStaticFiles)
app.mount("/hls", HLSStaticFiles(directory=HLS_DIR), name="hls")


@app.get("/devices")
def list_devices():
    """List avfoundation video capture devices and their indices.

    Indices change between machines/sessions, so the UI needs this to know
    which id to pass to /start_video instead of guessing.
    """
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-f", "avfoundation",
         "-list_devices", "true", "-i", ""],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    devices = []
    in_video = False
    for line in proc.stdout.splitlines():
        if "AVFoundation video devices" in line:
            in_video = True
            continue
        if "AVFoundation audio devices" in line:
            in_video = False
            continue
        if in_video:
            m = re.search(r"\[(\d+)\]\s+(.*)$", line)
            if m:
                devices.append({"index": int(m.group(1)), "name": m.group(2).strip()})
    return {"devices": devices}


class VideoStartRequest(BaseModel):
    type: int  # 0=single cam, 1=layered cams
    device_ids: List[int]

@app.post("/start_video")
def start_video(request: VideoStartRequest):
    # First, terminate any existing ffmpeg processes
    terminate_existing_ffmpeg_processes()

    # Clear leftovers from a previous run. append_list would otherwise continue
    # an old playlist — including a stale #EXT-X-ENDLIST that tells the player
    # the stream already ended, so it never starts polling for new segments.
    for f in HLS_DIR.glob("*.ts"):
        f.unlink(missing_ok=True)
    (HLS_DIR / "stream.m3u8").unlink(missing_ok=True)

    # The request data is automatically validated and parsed
    print(f"Starting video with params: {request}")

    # Use absolute paths so ffmpeg writes to the directory we actually serve,
    # regardless of the working directory run.py was started from.
    playlist = str(HLS_DIR / "stream.m3u8")
    segments = str(HLS_DIR / "seg_%05d.ts")

    if request.type == 0:
        cmd = f'''ffmpeg -hide_banner -loglevel info \
  -f avfoundation -framerate 30 -i "{str(request.device_ids[0])}:none" \
  -fflags +genpts -use_wallclock_as_timestamps 1 \
  -fps_mode cfr -r 30 \
  -vf "scale=1280:-2,format=yuv420p" \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list+omit_endlist \
  -hls_segment_filename "{segments}" \
  "{playlist}"'''

    elif request.type == 1 and len(request.device_ids) >= 2:
        cmd = f'''ffmpeg -hide_banner -loglevel info \
  -f avfoundation -framerate 30 -i "{str(request.device_ids[0])}:none" \
  -f avfoundation -framerate 30 -video_size 1280x720 -i "{str(request.device_ids[1])}:none" \
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
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list+omit_endlist \
  -hls_segment_filename "{segments}" \
  "{playlist}"'''
    else:
        return {"status": "error", "message": "Invalid request type or device_ids"}

    # Split the command into a list for subprocess
    cmd_parts = shlex.split(cmd.replace("\n", " "))
    
    # Start the new process
    process = subprocess.Popen(cmd_parts)
    print(f"FFmpeg command started with PID: {process.pid}")

    # Return confirmation
    return {
        "status": "started",
        "pid": process.pid,
        "params": {
            "type": request.type,
            "device_ids": request.device_ids
        }
    }

def terminate_existing_ffmpeg_processes():
    try:
        # Find all ffmpeg processes
        result = subprocess.run(['pgrep', '-f', 'ffmpeg'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        pids = result.stdout.strip().split('\n') if result.stdout.strip() else []
        
        for pid_str in pids:
            if pid_str:  # Skip empty strings
                pid = int(pid_str)
                print(f"Terminating existing ffmpeg process with PID: {pid}")
                try:
                    proc = subprocess.Popen(['kill', str(pid)])
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        # If process didn't terminate gracefully, force kill it
                        proc_force = subprocess.Popen(['kill', '-9', str(pid)])
                        proc_force.wait()
                        print(f"FFmpeg process {pid} forcibly killed")
                    print(f"FFmpeg process {pid} terminated")
                except ProcessLookupError:
                    print(f"Process {pid} already terminated")
                except Exception as e:
                    print(f"Error terminating process {pid}: {e}")
    except Exception as e:
        print(f"Error finding ffmpeg processes: {e}")

@app.post("/stop_video")
def stop_video():
    # Terminate all ffmpeg processes
    terminate_existing_ffmpeg_processes()
    return {"status": "stopped"}