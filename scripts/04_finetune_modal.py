"""Fine-tune GLiNER-2 on Modal A10G.
Trains gliner_large-v2.1 on the synth train set, evaluates on synth val,
saves model to Modal volume, and deploys an inference web endpoint.

Run:
  modal run scripts/04_finetune_modal.py            # train + return path
  modal deploy scripts/04_finetune_modal.py         # deploy inference endpoint
"""
import json
from pathlib import Path

import modal

app = modal.App("canon-gliner-ft")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "gliner==0.2.16",
        "transformers==4.45.0",
        "torch==2.5.0",
        "accelerate==1.0.0",
        "huggingface_hub",
        "fastapi[standard]",
    )
)

volume = modal.Volume.from_name("canon-gliner-models", create_if_missing=True)

MODEL_DIR = "/models/canon-inazuma-v1"
LABELS = [
    "EMPLOYEE", "EMPLOYEE_ID", "CUSTOMER_ID", "PRODUCT_ID", "TICKET_ID",
    "THREAD_ID", "AMOUNT", "DEPARTMENT", "POLICY_NAME", "DATE",
]


@app.function(image=image, gpu="A10G", timeout=3600, volumes={"/models": volume})
def train(train_jsonl: str, val_jsonl: str, base_model: str = "urchade/gliner_large-v2.1"):
    import json as _json
    import os
    from gliner import GLiNER
    from gliner.training import Trainer, TrainingArguments
    from gliner.data_processing.collator import DataCollator
    import torch

    print(f"CUDA: {torch.cuda.is_available()}, device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'}")
    print(f"Loading base: {base_model}")
    model = GLiNER.from_pretrained(base_model)

    train_data = [_json.loads(l) for l in train_jsonl.splitlines() if l.strip()]
    val_data = [_json.loads(l) for l in val_jsonl.splitlines() if l.strip()]
    print(f"Train: {len(train_data)} | Val: {len(val_data)}")

    os.makedirs(MODEL_DIR, exist_ok=True)
    args = TrainingArguments(
        output_dir=MODEL_DIR,
        num_train_epochs=3,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=8,
        learning_rate=5e-6,
        weight_decay=0.01,
        warmup_ratio=0.1,
        max_grad_norm=1.0,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="none",
        logging_steps=20,
        fp16=True,
        save_total_limit=1,
        seed=42,
    )

    data_collator = DataCollator(model.config, data_processor=model.data_processor, prepare_labels=True)
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_data,
        eval_dataset=val_data,
        data_collator=data_collator,
    )
    trainer.train()
    model.save_pretrained(MODEL_DIR)

    manifest = {
        "base_model": base_model,
        "train_examples": len(train_data),
        "val_examples": len(val_data),
        "labels": LABELS,
    }
    Path(MODEL_DIR).joinpath("manifest.json").write_text(_json.dumps(manifest, indent=2))
    volume.commit()
    print(f"\n✓ Model saved to {MODEL_DIR}")
    return MODEL_DIR


@app.function(image=image, gpu="T4", volumes={"/models": volume}, scaledown_window=300, min_containers=1)
@modal.fastapi_endpoint(method="POST")
def predict(req: dict):
    """POST {"text": "...", "labels": [...], "threshold": 0.4} -> {"spans": [{text,label,score,start,end}]}"""
    from gliner import GLiNER
    if not hasattr(predict, "_model"):
        predict._model = GLiNER.from_pretrained(MODEL_DIR)
    model = predict._model
    text = req["text"]
    labels = req.get("labels", LABELS)
    threshold = float(req.get("threshold", 0.4))
    spans = model.predict_entities(text, labels, threshold=threshold)
    return {"spans": spans}


@app.local_entrypoint()
def main():
    repo = Path(__file__).resolve().parent.parent
    train_jsonl = (repo / "data" / "synth" / "train.jsonl").read_text()
    val_jsonl = (repo / "data" / "synth" / "val.jsonl").read_text()
    out = train.remote(train_jsonl, val_jsonl)
    print(f"\nTrained model at: {out}")
    print("Now deploy: modal deploy scripts/04_finetune_modal.py")
