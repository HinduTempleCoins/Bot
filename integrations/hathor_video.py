"""hathor_video.py — Hathor makes a video from our renders, entirely on our CPU (ffmpeg + Piper TTS). No rented APIs.

  python hathor_video.py storyboard.json --out film.mp4

storyboard.json:
  { "voice": "/opt/melek-gen/voices/en_GB-alba-medium.onnx",
    "size": "1920x1080", "fps": 30,
    "shots": [ { "image": "path.png", "say": "narration for this shot", "caption": "optional on-screen text",
                 "min": 3.5 } , ... ] }

Each shot lasts as long as its narration (at least `min` seconds) plus a short tail, with a slow pan/zoom (Ken Burns)
and a crossfade into the next. The narration of all shots is one continuous track. Captions are burned in.
"""
import argparse, json, os, subprocess, sys, tempfile, wave

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
XFADE = 0.8   # crossfade seconds
TAIL = 0.6    # breath after each line


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd[:6])}...\n{r.stderr[-1500:]}")
    return r


def say(text, voice, out_wav):
    """Piper TTS on CPU → wav. Returns seconds."""
    from piper import PiperVoice
    v = say.cache.get(voice) or PiperVoice.load(voice)
    say.cache[voice] = v
    with wave.open(out_wav, "wb") as w:
        v.synthesize_wav(text, w)
    with wave.open(out_wav) as w:
        return w.getnframes() / w.getframerate()
say.cache = {}


def esc_drawtext(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def shot_clip(img, dur, W, H, fps, caption, out, idx):
    """One shot: fit the image into a W x H canvas (blurred fill behind), slow zoom-in, optional caption."""
    frames = int(dur * fps)
    zoom_in = idx % 2 == 0
    z = f"min(1+0.10*on/{frames},1.10)" if zoom_in else f"max(1.10-0.10*on/{frames},1.0)"
    vf = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=24:2,eq=brightness=-0.12[bg];"
          f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];"
          f"[bg][fg]overlay=(W-w)/2:(H-h)/2,scale={W*2}:{H*2},"
          f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={fps}")
    if caption:
        vf += (f",drawtext=fontfile={FONT}:text='{esc_drawtext(caption)}':fontcolor=white:fontsize={int(H*0.034)}:"
               f"box=1:boxcolor=black@0.45:boxborderw=18:x=(w-text_w)/2:y=h-text_h-{int(H*0.07)}")
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", img, "-filter_complex", vf, "-t", f"{dur:.3f}",
         "-r", str(fps), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out])


def build(board, out):
    W, H = (int(v) for v in board.get("size", "1920x1080").split("x"))
    fps = int(board.get("fps", 30))
    voice = board["voice"]
    tmp = tempfile.mkdtemp(prefix="hvid-")
    clips, durs, wavs = [], [], []
    for i, sh in enumerate(board["shots"]):
        wav = os.path.join(tmp, f"say{i}.wav")
        secs = say(sh["say"], voice, wav) if sh.get("say") else 0.0
        dur = max(secs + TAIL, float(sh.get("min", 3.5))) + XFADE
        clip = os.path.join(tmp, f"shot{i}.mp4")
        shot_clip(sh["image"], dur, W, H, fps, sh.get("caption", ""), clip, i)
        clips.append(clip); durs.append(dur); wavs.append((wav if secs else None, dur))
        print(f"shot {i+1}/{len(board['shots'])}: {dur:.1f}s", flush=True)

    # video: chain crossfades
    inputs = sum((["-i", c] for c in clips), [])
    if len(clips) == 1:
        vchain, vlast = "", "0:v"
    else:
        parts, prev, offset = [], "0:v", 0.0
        for i in range(1, len(clips)):
            offset += durs[i - 1] - XFADE
            lab = f"v{i}"
            parts.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[{lab}]")
            prev = lab
        vchain, vlast = ";".join(parts), prev
    video = os.path.join(tmp, "video.mp4")
    cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs]
    if vchain:
        cmd += ["-filter_complex", vchain, "-map", f"[{vlast}]"]
    run(cmd + ["-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20", video])

    # audio: each line starts when its shot starts (after the previous crossfade)
    starts, t = [], 0.0
    for i, d in enumerate(durs):
        starts.append(t + (XFADE if i else 0.3)); t += d - XFADE
    ain, amix = [], []
    for i, (wav, _d) in enumerate(wavs):
        if wav:
            ain += ["-i", wav]; n = len(ain) // 2 - 1
            amix.append(f"[{n}:a]adelay={int(starts[i]*1000)}|{int(starts[i]*1000)}[a{n}]")
    if amix:
        labels = "".join(f"[a{n}]" for n in range(len(amix)))
        audio = os.path.join(tmp, "voice.m4a")
        run(["ffmpeg", "-y", "-loglevel", "error", *ain, "-filter_complex",
             ";".join(amix) + f";{labels}amix=inputs={len(amix)}:normalize=0[a]", "-map", "[a]", "-c:a", "aac", "-b:a", "160k", audio])
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "copy", "-shortest", out])
    else:
        os.replace(video, out)
    total = sum(durs) - XFADE * (len(durs) - 1)
    print(f"DONE {out} ({total:.1f}s)")
    return total


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("storyboard"); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    build(json.load(open(a.storyboard)), a.out)
