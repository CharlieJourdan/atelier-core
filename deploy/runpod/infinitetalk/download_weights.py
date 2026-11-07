"""Downloads the InfiniteTalk weights ONCE onto the RunPod network volume (run it in a temporary pod, see README.md).

WRITTEN FROM THE PUBLIC README of https://github.com/MeiGen-AI/InfiniteTalk, read on 2026-11-01. NEVER RUN. Same four downloads as
the README ("huggingface-cli download ..."); the LoRA of the 8-step fast mode is downloaded too (its source is TO CONFIRM).
"""

import os
import pathlib
import sys

from huggingface_hub import hf_hub_download, snapshot_download

WEIGHTS = pathlib.Path(os.environ.get("WEIGHTS_DIR", "/runpod-volume/weights"))
# FusionX LoRA used by the README's 8-step example: its Hugging Face repo and path are TO CONFIRM (the README only names the file).
LORA_REPO = os.environ.get("LORA_REPO", "vrgamedevgirl84/Wan14BT2VFusioniX")
LORA_PATH = os.environ.get("LORA_PATH", "FusionX_LoRa/Wan2.1_I2V_14B_FusionX_LoRA.safetensors")


def main() -> int:
    WEIGHTS.mkdir(parents=True, exist_ok=True)
    snapshot_download("Wan-AI/Wan2.1-I2V-14B-480P", local_dir=str(WEIGHTS / "Wan2.1-I2V-14B-480P"))
    snapshot_download("TencentGameMate/chinese-wav2vec2-base", local_dir=str(WEIGHTS / "chinese-wav2vec2-base"))
    # the README also takes model.safetensors from the pull request revision refs/pr/1
    hf_hub_download("TencentGameMate/chinese-wav2vec2-base", "model.safetensors", revision="refs/pr/1", local_dir=str(WEIGHTS / "chinese-wav2vec2-base"))
    snapshot_download("MeiGen-AI/InfiniteTalk", local_dir=str(WEIGHTS / "InfiniteTalk"))
    try:
        path = hf_hub_download(LORA_REPO, LORA_PATH, local_dir=str(WEIGHTS / "_lora"))
        target = WEIGHTS / pathlib.Path(LORA_PATH).name
        if not target.exists():
            os.replace(path, target)
    except Exception as exc:  # noqa: BLE001
        print(f"LoRA not downloaded ({type(exc).__name__}): the 8-step mode needs it, check LORA_REPO / LORA_PATH", file=sys.stderr)
        return 1
    print("weights ready in", WEIGHTS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
