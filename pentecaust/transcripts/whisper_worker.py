"""whisper_worker.py — Pentecaust transcripts: make subtitles on our own CPU where no human ones exist.

  nice -n 19 python whisper_worker.py queue.json --out transcripts_work [--max 3] [--model small] [--threads 4]

For each queued item (shortest first): stream the audio from the Internet Archive mp4 through ffmpeg (16 kHz mono,
never storing the video), transcribe with faster-whisper (int8, VAD on), and write
<out>/<src>/<id>/en.ai-whisper.vtt + job.json (model, seconds of audio, seconds of CPU, language). Items already done
are skipped. One item at a time — this CPU is shared with the image batches.
"""
import argparse, json, os, subprocess, sys, tempfile, time


def fmt(t):
    t = max(0, int(round(t * 1000)))
    return f"{t // 3600000:02d}:{t % 3600000 // 60000:02d}:{t % 60000 // 1000:02d}.{t % 1000:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("queue")
    ap.add_argument("--out", default="transcripts_work")
    ap.add_argument("--max", type=int, default=3)
    ap.add_argument("--model", default="small")
    ap.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=a.threads)
    queue = json.load(open(a.queue))
    done = 0
    for it in queue:
        if done >= a.max:
            break
        d = os.path.join(a.out, it["src"], it["id"])
        if os.path.exists(os.path.join(d, "en.ai-whisper.vtt")):
            continue
        os.makedirs(d, exist_ok=True)
        t0 = time.time()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as wav:
            r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", it["mp4"], "-vn", "-ac", "1", "-ar", "16000", wav.name], capture_output=True, text=True)
            if r.returncode != 0:
                print(f"{it['id']}: ffmpeg failed: {r.stderr[-300:]}", flush=True)
                continue
            fetch_s = time.time() - t0
            t1 = time.time()
            segments, info = model.transcribe(wav.name, vad_filter=True, beam_size=1, condition_on_previous_text=False)
            cues = [(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
            cpu_s = time.time() - t1
        lines = ["WEBVTT", ""]
        for i, (s, e, t) in enumerate(cues, 1):
            lines += [str(i), f"{fmt(s)} --> {fmt(e)}", t, ""]
        open(os.path.join(d, "en.ai-whisper.vtt"), "w").write("\n".join(lines))
        job = {"src": it["src"], "id": it["id"], "title": it.get("title", ""), "mp4": it["mp4"], "model": f"faster-whisper {a.model} int8",
               "lang": info.language, "lang_prob": round(info.language_probability, 3), "audio_s": round(info.duration, 1),
               "fetch_s": round(fetch_s, 1), "cpu_s": round(cpu_s, 1), "cues": len(cues), "made": int(time.time())}
        json.dump(job, open(os.path.join(d, "job.json"), "w"), indent=1)
        done += 1
        print(f"{it['id']}: {len(cues)} cues, {job['audio_s']}s audio in {job['cpu_s']}s CPU ({info.language} {job['lang_prob']})", flush=True)
    print(f"done {done}")


if __name__ == "__main__":
    main()
