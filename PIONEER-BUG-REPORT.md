---
type: bug-report
audience: Fastino / Pioneer engineering
sender: Nelson Mehlis · nelson@ultranova.io · Big Berlin Hack 2026 · Project "Canon"
date: 2026-04-26
api_key_owner: 7f7b6970-d519-40b6-bf8b-9f82cb038ab2
severity: high (blocks all direct-API fine-tunes)
status: reproducible across 4 jobs (LoRA + Full)
---

# Pioneer Bug Report — `/felix/training-jobs` MME deployment never finds checkpoint

## TL;DR

Every training job created via `POST /felix/training-jobs` ends with status `errored`
because the post-training MME deploy step looks for a checkpoint under
`/s3_models/checkpoints/<user>/<job>/step-N.tar.gz`, but the training pipeline
only writes to the container-local path `/tmp/model_output/` (with a separate
adapter at `adapters/<user>/<job>.tar.gz`). The S3-upload step that should
populate `/s3_models/checkpoints/` never runs, so MME deploy fails 100% of the
time.

The Agent path (`POST /agent/runs`) **works correctly** — it must use a different
deploy code path. So the bug is isolated to the direct training-jobs API.

## Reproduction (any GLiNER fine-tune via direct API)

```bash
KEY="<api key>"

# 1. Upload dataset (works fine)
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"dataset_name":"repro","dataset_type":"ner","format":"jsonl",
       "filename":"train.jsonl","type":"training"}' \
  https://api.pioneer.ai/felix/datasets/upload/url
# → returns presigned_url + dataset_id

# (PUT JSONL to S3, POST /upload/process — both succeed)

# 2. Start training
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"model_name":"repro","datasets":[{"name":"repro"}],
       "base_model":"fastino/gliner2-base-v1",
       "training_type":"lora","nr_epochs":3,
       "validation_data_percentage":0.15,"batch_size":4}' \
  https://api.pioneer.ai/felix/training-jobs

# → job_id returned; status transitions: requested → running → errored

# 3. Inspect the failure
curl -H "X-API-Key: $KEY" \
  "https://api.pioneer.ai/felix/training-jobs/<job_id>"
# → status: errored
# → error_message: "MME deployment failed: Checkpoint not found:
#    /s3_models/checkpoints/<user>/<job>/step-N.tar.gz.
#    Training completed but model not deployed."
```

## Logs that show the actual cause

From `GET /felix/training-jobs/{job_id}/logs` for our most recent FULL training
job `33995582-08a1-4597-b7e8-a3578e096c0b`:

```
[07:29:58] [INFO]  Saved labels to /tmp/model_output/labels.json
[07:29:59] [INFO]  Checkpoint save frequency: every 200 steps
[07:31:07] [INFO]  🎉 New best validation loss: 1.1668!  (step 100)
[07:32:12] [INFO]  🎉 New best validation loss: 0.7427!  (step 200)
[07:33:16] [INFO]  No val loss improvement for 1 epoch(s)
[07:34:18] [INFO]  No val loss improvement for 2 epoch(s)   ← early stop
[07:34:19] [INFO]  Best validation loss: 0.7427
[07:34:19] [INFO]  Best checkpoint step: 200
[07:34:19] [INFO]  Best saved checkpoint step: None         ← ⚠️ NEVER UPLOADED
[07:34:19] [INFO]  Final checkpoint step: 400
[07:34:19] [INFO]  Saving model to /tmp/model_output       ← only local
[07:34:21] [INFO]  Saved training metadata to /tmp/model_output/training_metadata.json
[07:34:21] [INFO]  Deploying final checkpoint (step 400)...
[07:34:22] [ERROR] Checkpoint not found at /s3_models/checkpoints/<user>/<job>/step-400.tar.gz.
                   Available:
                     Directory does not exist: /s3_models/checkpoints/<user>/<job>
[07:34:22] [ERROR] ❌ Failed to deploy checkpoint to MME for job <job>:
                   Checkpoint not found ...
[07:34:22] [ERROR] Training failed with error: MME deployment failed
[07:34:21] [ERROR] Failed to report training to Stripe:
                   {'message': 'column users.stripe_customer_id does not exist'}  ← unrelated DB drift
[07:34:21] [INFO]  Updating training job status to 'errored'
```

The smoking gun is the line **`Best saved checkpoint step: None`** — the
periodic S3 upload that `Save Steps: 200` is supposed to trigger never fires.
Training writes locally to `/tmp/model_output` only, then the deploy step
(which reads from a totally different S3 prefix `/s3_models/checkpoints/`) is
left with nothing to load.

## Reproducibility — bug appears for both training types

We hit it on **4 jobs across both LoRA and Full training**:

| Job ID (prefix) | training_type | nr_epochs | lr     | Outcome |
|---|---|---|---|---|
| `e9ca957c…` | lora | 5 | 5e-5 | training OK, deploy errored |
| `f1541380…` | lora | 3 | 5e-5 | training OK, deploy errored |
| `8b8c3d90…` | lora | 3 | 5e-5 | training OK, deploy errored |
| `33995582…` | full | 3 | 5e-5 | training OK, deploy errored |

In every case `Best saved checkpoint step: None` appears in the logs and the
S3 directory `/s3_models/checkpoints/<user>/<job>/` does not exist.

For comparison, an Agent-triggered job (`29473289-ef37-4dc7-ae00-068ff38ee298`,
trigger via `POST /agent/runs`) on the same account **succeeded** — it landed
at status=`deployed` with `provider_deployments.modal.normalized_adapter_path =
adapters/<user>/<job>` populated, and `/inference` works against its
`model_id`. So the deploy path itself isn't broken — only the path that the
direct API ends up on.

## Cascading lockout: errored status blocks every recovery path

Once a job is `errored`, every alternative recovery surface refuses it:

```
POST /felix/training-jobs/<job>/checkpoints/<cp>/deploy
  → 400 "Invalid request."

POST /projects/<pid>/deployments  {"training_job_id":"<job>"}
  → 200 (records the deployment)
  but POST /inference {"model_id":"<job>", ...}
  → 404 "Model not found or not accessible."  (still gated on MME)

POST /felix/training-jobs/<job>/push-to-hub
  → 400 "Training job not complete. Current status: errored"

GET  /felix/training-jobs/<job>/download
  → 400 "Training job not complete. Current status: errored"

POST /felix/evaluations  {"base_model":"<job>", ...}
  → 400 "Training job '<job>' is not ready for evaluation. Current training status: failed"
```

The root MME deploy failure stamps `errored`, which then locks push-to-hub,
download, evaluate, and inference — even though the trained adapter actually
exists at `adapters/<user>/<job>.tar.gz` (visible in
`POST /felix/training-jobs/<job>/sync` response field `trained_model_path`).

## What the fix probably is

One of:

1. **Wire the `Save Steps: N` checkpoint loop to actually upload to
   `/s3_models/checkpoints/<user>/<job>/step-N.tar.gz`** during training (the
   training trainer logs say it has an "async I/O enabled" thread pool — looks
   like the upload code path may exist but isn't wired in for direct-API jobs)
2. **OR** point the MME deploy reader at `adapters/<user>/<job>.tar.gz` (where
   the actual trained adapter lives) instead of `/s3_models/checkpoints/.../step-N.tar.gz`
3. **OR** make the deploy fallback to the Agent's deploy code path (which works
   for the same training output)

A secondary improvement: when MME deploy fails but training itself succeeded,
mark the job status as `complete` (not `errored`) so users can at least
`/push-to-hub` or `/download` to recover their trained model — currently the
job is unreachable from every angle.

## Side-finding: GLiNER hyperparameter default in Agent Mode

The Agent's deployed job ran with `learning_rate=1e-4` and `nr_epochs=15` — for
GLiNER this is ~20× the [GLiNER repo's recommended `5e-6`](https://github.com/urchade/GLiNER)
and causes catastrophic forgetting on harder labels (in our eval, several
fine-grained ID labels regressed from zero-shot 0.52→0.38, 0.84→0.74, etc.,
even as the loss curve looked good — `final_validation_loss=1.337`).

Suggest defaulting Agent `gliner` runs to `5e-6` (or splitting
`encoder_learning_rate` low + `task_learning_rate` higher per the
`TrainingJobCreate` schema fields that already exist).

## What we shipped despite the bug

- Trained 4 jobs through `/felix/training-jobs` (all hit the bug — recorded with logs).
- Triggered `/agent/runs`, which deployed `29473289-…` successfully on Pioneer.
- Trained the open `gliner_large-v2.1` on Modal with `lr=5e-6` to compare.
- Both deployed extractors integrated into our project (env-flag-gated).

Eval on a 77-example hand-graded gold set (Inazuma corpus):

| System | Macro-F1 |
|---|---|
| Pioneer GLiNER-2 zero-shot | 0.596 |
| Gemini 2.5-flash (frontier) | 0.967 |
| Pioneer-deployed (Agent-trained) | 0.518  ← regressed due to lr default |
| Open base @ lr=5e-6 (Modal) | **0.955** ← within 1.2pp of frontier |

So: Pioneer's pipeline architecturally works (Agent-deployed model serves
inference flawlessly with all 10 entity types extracted at high confidence),
the data + task are sound (open base reaches 0.955 with the recommended LR),
the bug above and the LR default are the only two things in the way of a
9.55-out-of-9.67 result via Pioneer's own platform.

## Repository

Full repo, scripts, dataset, eval logs, reproduction steps:
**https://github.com/ThePyth0nKid/canonBigHackBerlin**
(branch: `pioneer-ft`, commit `9b41159`)

## Contact

Nelson Mehlis · nelson@ultranova.io · @netzwerknelly on HF
Built solo at Big Berlin Hack 2026, Track Qontext, Project Canon.
Happy to walk through any of this live.
