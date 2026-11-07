# Modal app for Atelier's remote render (vps-rendu, decision 0084). WRITTEN FROM MODAL'S PUBLIC DOCS (read 2026-11-03:
# guide/existing-images, guide/job-queue, guide/webhook-proxy-auth, guide/resources, guide/region-selection), NEVER RUN YET.
# One render function on our worker image (3 physical cores = 6 vCPU, 12 GiB, EU) and one small web endpoint behind proxy
# auth that the Cloud calls (cloud/src/render/starters.ts, modalStarter):
#   POST /submit {jobUrl, timeoutS} -> {callId}      GET /result?call_id=  -> 202 while running, else {state, billedS, error}
#   POST /cancel {callId}
# Deploy:  ATELIER_RENDER_IMAGE=<registry>/atelier-render-worker:<tag> modal deploy deploy/render-worker/modal_app.py
# Then put in the Cloud's vault: MODAL_RENDER_URL (the printed *.modal.run address of `web`), MODAL_PROXY_KEY and
# MODAL_PROXY_SECRET (a proxy auth token: `modal workspace proxy-tokens` or the dashboard).
import os
import subprocess
import time

import modal

IMAGE = os.environ.get("ATELIER_RENDER_IMAGE", "docker.io/CHANGE-ME/atelier-render-worker:1")

# the worker image has Node and our code in /app; Modal adds its own Python; our ENTRYPOINT is cleared (Modal runs its own)
image = modal.Image.from_registry(IMAGE, add_python="3.12").entrypoint([])
web_image = modal.Image.debian_slim().pip_install("fastapi[standard]")
app = modal.App("atelier-render")

WORKER = ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--disable-warning=ExperimentalWarning", "--import", "./scripts/ts-resolve.mjs", "scripts/render-job.ts"]


@app.function(image=image, cpu=3.0, memory=12288, timeout=3600, region="eu", retries=0)
def render(job_url: str) -> dict:
    t0 = time.time()
    r = subprocess.run(WORKER, cwd="/app", env={**os.environ, "ATELIER_JOB_URL": job_url}, capture_output=True, text=True)
    out = {"ok": r.returncode == 0, "billedS": round(time.time() - t0, 3)}
    if r.returncode != 0:
        out["error"] = (r.stderr or "")[-300:]
    return out


@app.function(image=web_image)
@modal.asgi_app(requires_proxy_auth=True)
def web():
    from fastapi import FastAPI, Response

    api = FastAPI()

    @api.post("/submit")
    def submit(body: dict):
        call = render.spawn(body["jobUrl"])
        return {"callId": call.object_id}

    @api.get("/result")
    def result(call_id: str, response: Response):
        call = modal.FunctionCall.from_id(call_id)
        try:
            r = call.get(timeout=0)
        except TimeoutError:
            response.status_code = 202
            return {"state": "running"}
        except Exception as e:  # cancelled, crashed, expired
            return {"state": "failed", "error": str(e)[:300]}
        state = "succeeded" if r.get("ok") else "failed"
        return {"state": state, "billedS": r.get("billedS"), **({"error": r["error"]} if r.get("error") else {})}

    @api.post("/cancel")
    def cancel(body: dict):
        modal.FunctionCall.from_id(body["callId"]).cancel()
        return {"ok": True}

    return api
