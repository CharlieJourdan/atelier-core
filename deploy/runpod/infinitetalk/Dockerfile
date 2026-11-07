# RunPod serverless worker for InfiniteTalk (engine presenter:infinitetalk-gpu).
# WRITTEN FROM THE PUBLIC README of https://github.com/MeiGen-AI/InfiniteTalk (Apache-2.0), read on 2026-11-01. NEVER BUILT OR RUN.
# README steps followed: python 3.10, torch 2.4.1 + torchvision 0.19.1 + torchaudio 2.4.1 (cu121), xformers 0.0.28, flash_attn
# 2.7.4.post1, requirements.txt, librosa, ffmpeg. The weights are NOT in the image: they live on the network volume
# (/runpod-volume/weights, see download_weights.py), so the image stays small and a new version never re-downloads 80 GB.
# Build context = this folder:  docker build -t <your-registry>/atelier-infinitetalk:1 deploy/runpod/infinitetalk
FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3.10 python3-pip python3.10-dev git ffmpeg libsndfile1 build-essential ninja-build \
    && ln -sf /usr/bin/python3.10 /usr/bin/python && rm -rf /var/lib/apt/lists/*

RUN pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121 \
    && pip install -U xformers==0.0.28 --index-url https://download.pytorch.org/whl/cu121 \
    && pip install misaki[en] ninja psutil packaging wheel \
    && pip install flash_attn==2.7.4.post1 --no-build-isolation

WORKDIR /app
# Pin a commit once the first run works (replace main by its hash) so a later change of the repo cannot break the worker.
ARG INFINITETALK_REF=main
RUN git clone https://github.com/MeiGen-AI/InfiniteTalk.git && cd InfiniteTalk && git checkout ${INFINITETALK_REF} \
    && pip install -r requirements.txt && pip install librosa runpod huggingface_hub

COPY handler.py download_weights.py /app/

ENV INFINITETALK_DIR=/app/InfiniteTalk WEIGHTS_DIR=/runpod-volume/weights QUANT=fp8 PERSISTENT_PARAMS=0
CMD ["python", "-u", "/app/handler.py"]
