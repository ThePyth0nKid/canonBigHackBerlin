"""End-to-end Pioneer-native fine-tune pipeline.

Replaces Modal: uses Pioneer's `/felix/` API to upload, train, and deploy.

Steps:
  1. Combine train.jsonl + val.jsonl (Pioneer auto-splits)
  2. POST /felix/datasets/upload/url → presigned S3 URL + dataset_id
  3. PUT data to S3
  4. POST /felix/datasets/upload/process → start ingestion
  5. Poll dataset status
  6. POST /felix/training-jobs with base_model=fastino/gliner2-base-v1
  7. Poll training-job status
  8. POST /felix/training-jobs/{id}/checkpoints/{cp_id}/deploy
  9. Print the deployed inference URL
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests

from ft_common import LABELS, PIONEER_KEY, REPO

API_BASE = "https://api.pioneer.ai"
HEADERS = {"X-API-Key": PIONEER_KEY}

DATASET_NAME = f"canon-inazuma-{int(time.time())}"
MODEL_NAME = f"canon-inazuma-v1-{int(time.time())}"
BASE_MODEL = "fastino/gliner2-base-v1"


def _post(path, body=None, files=None):
    url = f"{API_BASE}{path}"
    if files:
        r = requests.post(url, headers=HEADERS, files=files, timeout=60)
    else:
        r = requests.post(url, headers={**HEADERS, "Content-Type": "application/json"}, json=body, timeout=60)
    if not r.ok:
        print(f"POST {path} -> {r.status_code}\n{r.text[:1500]}", file=sys.stderr)
        r.raise_for_status()
    return r.json()


def _get(path):
    r = requests.get(f"{API_BASE}{path}", headers=HEADERS, timeout=60)
    if not r.ok:
        print(f"GET {path} -> {r.status_code}\n{r.text[:1500]}", file=sys.stderr)
        r.raise_for_status()
    return r.json()


def step1_combine_data():
    """Merge train + val into a single JSONL file (Pioneer auto-splits)."""
    train = (REPO / "data" / "synth" / "train.jsonl").read_text().strip()
    val = (REPO / "data" / "synth" / "val.jsonl").read_text().strip()
    combined_path = REPO / "data" / "synth" / "pioneer-upload.jsonl"
    combined_path.write_text(train + "\n" + val + "\n")
    n = sum(1 for _ in open(combined_path))
    print(f"  Combined: {n} examples → {combined_path}")
    return combined_path


def step2_get_upload_url(filename):
    body = {
        "dataset_name": DATASET_NAME,
        "dataset_type": "ner",
        "format": "jsonl",
        "filename": filename,
        "type": "training",
    }
    print(f"  POST /felix/datasets/upload/url body={body}")
    r = _post("/felix/datasets/upload/url", body)
    print(f"  → dataset_id={r['dataset_id']}, version={r['version_number']}")
    return r


def step3_put_to_s3(presigned_url, file_path):
    print(f"  PUT {file_path.name} ({file_path.stat().st_size:,} bytes) → S3")
    with open(file_path, "rb") as f:
        r = requests.put(
            presigned_url,
            data=f.read(),
            headers={"Content-Type": "application/octet-stream"},
            timeout=120,
        )
    print(f"  → S3 status {r.status_code}")
    if not r.ok:
        print(f"  S3 ERROR: {r.text[:500]}", file=sys.stderr)
        r.raise_for_status()


def step4_process(dataset_id):
    body = {"dataset_id": dataset_id}
    print(f"  POST /felix/datasets/upload/process body={body}")
    r = _post("/felix/datasets/upload/process", body)
    print(f"  → {json.dumps(r)[:300]}")
    return r


def step5_poll_dataset(dataset_name, version, timeout_s=600):
    print(f"  Polling dataset status...")
    deadline = time.time() + timeout_s
    last_status = None
    while time.time() < deadline:
        try:
            r = _get(f"/felix/datasets/{dataset_name}/{version}")
            status = r.get("status") or r.get("dataset", {}).get("status") or "?"
            if status != last_status:
                print(f"    [{int(time.time() - (deadline - timeout_s))}s] status={status}")
                last_status = status
            if status in ("ready", "complete", "completed", "active"):
                print(f"  ✓ Dataset ready")
                return r
            if status in ("error", "failed", "errored"):
                print(f"  ✗ Dataset processing failed: {r}", file=sys.stderr)
                sys.exit(1)
        except Exception as e:
            print(f"    poll error: {e}")
        time.sleep(5)
    print("  ✗ Timed out waiting for dataset", file=sys.stderr)
    sys.exit(1)


def step6_create_training_job(dataset_name):
    body = {
        "model_name": MODEL_NAME,
        "datasets": [{"name": dataset_name}],
        "base_model": BASE_MODEL,
        "training_type": "lora",
        "validation_data_percentage": 0.15,
        "nr_epochs": 5,
        "learning_rate": 5e-5,
        "batch_size": 8,
        "early_stopping_patience": 2,
    }
    print(f"  POST /felix/training-jobs body={json.dumps(body, indent=2)}")
    r = _post("/felix/training-jobs", body)
    job_id = r.get("id") or r.get("job_id") or r.get("training_job", {}).get("id")
    print(f"  → job_id={job_id}")
    if not job_id:
        print(f"  ✗ Couldn't extract job_id from response: {r}", file=sys.stderr)
        sys.exit(1)
    return job_id, r


def step7_poll_job(job_id, timeout_s=3600):
    print(f"  Polling training job {job_id}...")
    deadline = time.time() + timeout_s
    last_status = None
    while time.time() < deadline:
        try:
            r = _get(f"/felix/training-jobs/{job_id}")
            tj = r.get("training_job") or r
            status = tj.get("status", "?")
            progress = tj.get("progress") or tj.get("current_epoch")
            if status != last_status or progress:
                msg = f"    status={status}"
                if progress is not None:
                    msg += f" progress={progress}"
                print(msg)
                last_status = status
            if status in ("complete", "completed", "deployed"):
                print(f"  ✓ Training complete")
                return tj
            if status in ("error", "failed", "errored", "cancelled"):
                err = tj.get("error_message") or tj.get("error") or "?"
                print(f"  ✗ Training failed: {err}", file=sys.stderr)
                sys.exit(1)
        except Exception as e:
            print(f"    poll error: {e}")
        time.sleep(10)
    print("  ✗ Timed out waiting for training", file=sys.stderr)
    sys.exit(1)


def step8_list_checkpoints(job_id):
    r = _get(f"/felix/training-jobs/{job_id}/checkpoints")
    cps = r.get("checkpoints", r) if isinstance(r, dict) else r
    print(f"  Checkpoints: {len(cps) if isinstance(cps, list) else '?'}")
    return cps


def step9_deploy_checkpoint(job_id, checkpoint_id):
    print(f"  POST /felix/training-jobs/{job_id}/checkpoints/{checkpoint_id}/deploy")
    r = _post(f"/felix/training-jobs/{job_id}/checkpoints/{checkpoint_id}/deploy", {})
    print(f"  → {json.dumps(r, indent=2)[:1500]}")
    return r


def main():
    print("=" * 70)
    print("Pioneer-native fine-tune pipeline (canon-inazuma)")
    print("=" * 70)

    print("\n[1] Combine train + val into single JSONL")
    upload_path = step1_combine_data()

    print("\n[2] Get presigned upload URL")
    upload_info = step2_get_upload_url(upload_path.name)
    dataset_id = upload_info["dataset_id"]
    version = str(upload_info["version_number"])

    print("\n[3] PUT to S3")
    step3_put_to_s3(upload_info["presigned_url"], upload_path)

    print("\n[4] Trigger Pioneer processing")
    step4_process(dataset_id)

    print("\n[5] Poll dataset status")
    step5_poll_dataset(DATASET_NAME, version)

    print("\n[6] Create training job")
    job_id, _ = step6_create_training_job(DATASET_NAME)

    print("\n[7] Poll training job")
    final = step7_poll_job(job_id)

    print("\n[8] List checkpoints")
    cps = step8_list_checkpoints(job_id)

    print("\n[9] Deploy best checkpoint")
    if isinstance(cps, list) and cps:
        # Pick last (typically best with early-stop)
        cp = cps[-1]
        cp_id = cp.get("id") or cp.get("checkpoint_id")
        if cp_id:
            deploy_info = step9_deploy_checkpoint(job_id, cp_id)
            print("\n=== DEPLOYED ===")
            print(json.dumps(deploy_info, indent=2))
        else:
            print(f"  ✗ No checkpoint_id in {cp}", file=sys.stderr)
    else:
        print(f"  No checkpoints listed: {cps}", file=sys.stderr)

    # Save manifest
    manifest = {
        "dataset_name": DATASET_NAME,
        "model_name": MODEL_NAME,
        "base_model": BASE_MODEL,
        "job_id": job_id,
        "training_job": final,
    }
    out = REPO / "data" / "results" / "pioneer-training-manifest.json"
    out.write_text(json.dumps(manifest, indent=2))
    print(f"\nManifest: {out}")


if __name__ == "__main__":
    main()
