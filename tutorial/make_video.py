from __future__ import annotations
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEG = ROOT / 'segments'
SEG.mkdir(exist_ok=True)
slides = sorted((ROOT / 'slides').glob('slide_*.png'))
audios = sorted((ROOT / 'audio').glob('slide_*.mp3'))
assert len(slides) == len(audios)

segments = []
for slide, audio in zip(slides, audios):
    duration = float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(audio)
    ], text=True).strip())
    out = SEG / f'{slide.stem}.mp4'
    cmd = [
        'ffmpeg', '-y', '-loop', '1', '-framerate', '30', '-i', str(slide), '-i', str(audio),
        '-t', f'{duration + 0.35:.3f}', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-shortest', '-vf', 'scale=1920:1080,format=yuv420p', str(out)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    segments.append(out)

concat = ROOT / 'concat.txt'
concat.write_text(''.join(f"file '{p.as_posix()}'\n" for p in segments))
final = ROOT / 'stream-chat-aggregator-tutorial.mp4'
subprocess.run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat), '-c', 'copy', str(final)], check=True)
print(final)
