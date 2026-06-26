import subprocess
from typing import List, Optional
import shlex

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path

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

# Serve HLS segments
app.mount("/hls", StaticFiles(directory=BASE_DIR / "hls"), name="hls")


class VideoStartRequest(BaseModel):
    type: int  # 0=single cam, 1=layered cams
    device_ids: List[int]

@app.post("/start_video")
def start_video(request: VideoStartRequest):
    # First, terminate any existing ffmpeg processes
    terminate_existing_ffmpeg_processes()
    
    # The request data is automatically validated and parsed
    print(f"Starting video with params: {request}")

    if request.type == 0:
        cmd = f'''ffmpeg -hide_banner -loglevel info \
  -f avfoundation -framerate 30 -i "{str(request.device_ids[0])}:none" \
  -fflags +genpts -use_wallclock_as_timestamps 1 \
  -vsync cfr -r 30 \
  -vf "scale=1280:-2,format=yuv420p" \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -f hls -hls_time 2 -hls_list_size 6 \
  -hls_flags delete_segments+append_list \
  hls/stream.m3u8'''

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
  -f hls -hls_time 2 -hls_list_size 6 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "hls/seg_%05d.ts" \
  hls/stream.m3u8'''
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