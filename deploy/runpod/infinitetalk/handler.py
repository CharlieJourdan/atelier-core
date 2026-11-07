"""RunPod serverless handler for InfiniteTalk (engine presenter:infinitetalk-gpu of Atelier Cloud).

WRITTEN FROM THE PUBLIC README of https://github.com/MeiGen-AI/InfiniteTalk (Apache-2.0), read on 2026-11-01. NEVER RUN:
every flag and the input-JSON shape below are to be checked on the first deploy (see README.md, "A vérifier").

Contract with cloud/src/providers/infinitetalk-gpu.ts
  input : { image_url, audio_url, resolution: "480p" | "720p", steps: int, seed: int, prompt?: str }
          image_url / audio_url are short signed https links of the Atelier Cloud's own storage.
  output: { video_url } when a bucket is configured (BUCKET_ENDPOINT_URL, BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY: RunPod's
          own upload helper answers a presigned link), else { video_base64 } for a clip small enough for RunPod's answer limit;
          always { gpu_seconds } (time of the generation itself). A failure is { "error": "..." } (RunPod marks the job FAILED).
  The executionTimeout / ttl of the job are set by the Cloud (the cost ceiling): this handler never waits longer on its own.
"""

import base64
import json
import math
import os
import pathlib
import subprocess
import tempfile
import time
import urllib.request

import runpod

REPO = pathlib.Path(os.environ.get("INFINITETALK_DIR", "/app/InfiniteTalk"))
WEIGHTS = pathlib.Path(os.environ.get("WEIGHTS_DIR", "/runpod-volume/weights"))
# 24 GB cards (4090): fp8 weights + parameters kept off the GPU (README: "--quant fp8", "--num_persistent_param_in_dit 0").
QUANT = os.environ.get("QUANT", "fp8")  # "fp8" or "" (no quantisation, for 48 GB and more)
PERSISTENT = os.environ.get("PERSISTENT_PARAMS", "0")  # "" to leave the flag out (48 GB and more)
LORA_FILE = os.environ.get("LORA_FILE", "Wan2.1_I2V_14B_FusionX_LoRA.safetensors")
FPS = 25  # the model's frame rate (README: 1000 frames is about 40 seconds)
MAX_DOWNLOAD = 60 * 1024 * 1024
MAX_BASE64_BYTES = int(os.environ.get("MAX_BASE64_BYTES", str(7 * 1024 * 1024)))
SIZES = {"480p": "infinitetalk-480", "720p": "infinitetalk-720"}


def fail(message: str) -> dict:
    return {"error": message}


def download(url: str, dest: pathlib.Path) -> None:
    if not url.startswith("https://"):
        raise ValueError("only https links are fetched")
    with urllib.request.urlopen(url, timeout=120) as res, open(dest, "wb") as out:  # noqa: S310 (https checked above)
        size = 0
        while True:
            chunk = res.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_DOWNLOAD:
                raise ValueError("a file is too large")
            out.write(chunk)


def seconds_of(path: pathlib.Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def check_weights() -> str | None:
    need = [
        WEIGHTS / "Wan2.1-I2V-14B-480P",
        WEIGHTS / "chinese-wav2vec2-base",
        WEIGHTS / "InfiniteTalk" / "single" / "infinitetalk.safetensors",
    ]
    if QUANT == "fp8":
        need.append(WEIGHTS / "InfiniteTalk" / "quant_models" / "infinitetalk_single_fp8.safetensors")
    missing = [str(p) for p in need if not p.exists()]
    return None if not missing else "weights missing on the network volume (run download_weights.py once): " + ", ".join(missing)


def build_command(work: pathlib.Path, resolution: str, steps: int, seed: int, frames: int, save_file: pathlib.Path) -> list[str]:
    cmd = [
        "python", "generate_infinitetalk.py",
        "--ckpt_dir", str(WEIGHTS / "Wan2.1-I2V-14B-480P"),
        "--wav2vec_dir", str(WEIGHTS / "chinese-wav2vec2-base"),
        "--infinitetalk_dir", str(WEIGHTS / "InfiniteTalk" / "single" / "infinitetalk.safetensors"),
        "--input_json", str(work / "input.json"),
        "--size", SIZES[resolution],
        "--sample_steps", str(steps),
        "--mode", "streaming",
        "--motion_frame", "9",
        "--max_frame_num", str(frames),
        "--base_seed", str(seed),
        "--save_file", str(save_file),
    ]
    if steps <= 8:
        # README "LoRA / LightX2V (4-8 steps)": the example uses the FusionX LoRA at 8 steps
        cmd += [
            "--lora_dir", str(WEIGHTS / LORA_FILE), "--lora_scale", "1.0",
            "--sample_text_guide_scale", "1.0", "--sample_audio_guide_scale", "2.0", "--sample_shift", "2",
        ]
    if QUANT == "fp8":
        cmd += ["--quant", "fp8", "--quant_dir", str(WEIGHTS / "InfiniteTalk" / "quant_models" / "infinitetalk_single_fp8.safetensors")]
    if PERSISTENT != "":
        cmd += ["--num_persistent_param_in_dit", PERSISTENT]
    return cmd


def handler(job: dict) -> dict:
    inp = job.get("input") or {}
    resolution = inp.get("resolution", "480p")
    steps = int(inp.get("steps", 8))
    seed = int(inp.get("seed", 42))
    if resolution not in SIZES:
        return fail("resolution must be 480p or 720p")
    if not (2 <= steps <= 50):
        return fail("steps must be between 2 and 50")
    for key in ("image_url", "audio_url"):
        if not isinstance(inp.get(key), str):
            return fail(f"{key} is missing")
    problem = check_weights()
    if problem:
        return fail(problem)

    with tempfile.TemporaryDirectory(prefix="itk-") as tmp:
        work = pathlib.Path(tmp)
        try:
            download(inp["image_url"], work / "face.img")
            download(inp["audio_url"], work / "voice.raw")
            # the model reads a 16 kHz mono wav (README examples use .wav)
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "voice.raw"), "-ac", "1", "-ar", "16000", str(work / "voice.wav")], check=True)
            # a still image is converted to PNG so any input type works
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(work / "face.img"), str(work / "face.png")], check=True)
            duration = seconds_of(work / "voice.wav")
        except Exception as exc:  # noqa: BLE001 - a bad input must come back as a clear message
            return fail(f"input could not be prepared: {type(exc).__name__}")

        # input JSON as in examples/single_example_image.json (TO CONFIRM against the repo's file)
        spec = {
            "prompt": inp.get("prompt") or "A person is talking to the camera, calm and natural.",
            "cond_video": str(work / "face.png"),
            "cond_audio": {"person1": str(work / "voice.wav")},
        }
        (work / "input.json").write_text(json.dumps(spec), encoding="utf-8")

        frames = int(math.ceil(duration * FPS)) + FPS  # README: --max_frame_num defaults to 1000 frames (about 40 s)
        save_file = work / "result"
        started = time.monotonic()
        run = subprocess.run(build_command(work, resolution, steps, seed, frames, save_file), cwd=REPO, capture_output=True, text=True)
        gpu_seconds = time.monotonic() - started
        if run.returncode != 0:
            return fail("generation failed: " + (run.stderr or run.stdout)[-300:].replace("\n", " "))
        video = next(iter(sorted(work.glob("result*.mp4"))), None)
        if video is None:
            return fail("generation finished but no mp4 was written")

        if os.environ.get("BUCKET_ENDPOINT_URL"):
            from runpod.serverless.utils import rp_upload  # RunPod's helper: S3-compatible bucket, answers a presigned link

            link = rp_upload.upload_file_to_bucket(video.name, str(video))
            return {"video_url": link, "gpu_seconds": gpu_seconds}
        size = video.stat().st_size
        if size > MAX_BASE64_BYTES:
            return fail(f"the clip is {size} bytes, too big to answer inline: configure the bucket (BUCKET_* variables), see README.md")
        return {"video_base64": base64.b64encode(video.read_bytes()).decode("ascii"), "gpu_seconds": gpu_seconds}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
