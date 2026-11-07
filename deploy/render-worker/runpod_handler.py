# RunPod serverless handler for Atelier's remote render (vps-rendu). WRITTEN FROM RUNPOD'S PUBLIC DOCS (read 2026-11-03:
# serverless/workers/handler-functions, serverless/endpoints/send-requests), NEVER RUN YET. The Cloud sends {"jobUrl": …}
# (cloud/src/render/starters.ts, runpodRenderStarter); the worker program does the rest through the job's links.
import os
import subprocess
import time

import runpod

WORKER = ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--import", "./scripts/ts-resolve.mjs", "scripts/render-job.ts"]


def handler(job):
    url = job["input"]["jobUrl"]
    t0 = time.time()
    r = subprocess.run(WORKER, cwd="/app", env={**os.environ, "ATELIER_JOB_URL": url}, capture_output=True, text=True)
    if r.returncode != 0:
        return {"ok": False, "error": "worker: " + (r.stderr or "")[-300:]}
    return {"ok": True, "wallS": round(time.time() - t0, 3)}


runpod.serverless.start({"handler": handler})
