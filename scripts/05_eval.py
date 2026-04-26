"""Evaluate all systems on the gold test set.

Systems:
  1. Pioneer GLiNER-2 zero-shot
  2. Gemini 2.5-flash structured-out (frontier)
  3. Our fine-tuned model (Modal endpoint)

Computes per-label precision/recall/F1 + macro-F1.

Output:
  data/results/eval-final.md       (markdown table)
  data/results/eval-final.json     (raw numbers)
  data/results/comparison.png      (bar chart) — if matplotlib available
"""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import requests
from google import genai
from google.genai import types

from ft_common import (
    DATA,
    GOLD_PATH,
    GOOGLE_CLOUD_LOCATION,
    GOOGLE_CLOUD_PROJECT,
    LABEL_DESCRIPTIONS,
    LABELS,
    PIONEER_KEY,
    PIONEER_URL,
    load_jsonl,
    validate_span,
)

OURS_URL = os.environ.get("GLINER_FT_ENDPOINT", "")
PIONEER_FT_MODEL_ID = os.environ.get("PIONEER_FT_MODEL_ID", "29473289-ef37-4dc7-ae00-068ff38ee298")


def label_str():
    return "\n".join(f"- {lbl}: {LABEL_DESCRIPTIONS[lbl]}" for lbl in LABELS)


# -------- Predictors --------

def pioneer_predict(text: str):
    body = {
        "task": "extract_entities",
        "text": text,
        "schema": list(LABELS),
        "threshold": 0.4,
        "include_spans": True,
        "format_results": False,
    }
    r = requests.post(PIONEER_URL, headers={"X-API-Key": PIONEER_KEY}, json=body, timeout=30)
    r.raise_for_status()
    result = r.json().get("result", {})
    entities_list = result.get("entities", [])
    if not entities_list:
        return []
    by_label = entities_list[0]
    out = []
    for lbl in LABELS:
        for hit in by_label.get(lbl, []) or []:
            surface = hit.get("text") if isinstance(hit, dict) else str(hit)
            if surface:
                out.append({"text": surface, "label": lbl})
    return out


_gemini = None


def gemini_predict(text: str):
    global _gemini
    if _gemini is None:
        if GOOGLE_CLOUD_PROJECT:
            _gemini = genai.Client(vertexai=True, project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)
        else:
            _gemini = genai.Client()
    schema = {
        "type": "OBJECT",
        "properties": {
            "spans": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {"text": {"type": "STRING"}, "label": {"type": "STRING", "enum": LABELS}},
                    "required": ["text", "label"],
                },
            }
        },
        "required": ["spans"],
    }
    prompt = f"Extract NER spans for these labels:\n{label_str()}\n\nReturn JSON {{spans:[{{text,label}}]}}.\nText:\n\"\"\"\n{text}\n\"\"\""
    resp = _gemini.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.0,
        ),
    )
    try:
        return json.loads(resp.text).get("spans", [])
    except Exception:
        return []


def ours_predict(text: str):
    if not OURS_URL:
        return []
    r = requests.post(OURS_URL, json={"text": text, "labels": LABELS, "threshold": 0.4}, timeout=30)
    r.raise_for_status()
    return r.json().get("spans", [])


def pioneer_ft_predict(text: str):
    """Inference via our Pioneer-deployed fine-tuned model (training_job_id)."""
    body = {
        "model_id": PIONEER_FT_MODEL_ID,
        "task": "extract_entities",
        "text": text,
        "schema": list(LABELS),
        "threshold": 0.4,
        "include_spans": True,
    }
    r = requests.post(
        "https://api.pioneer.ai/inference",
        headers={"X-API-Key": PIONEER_KEY, "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    r.raise_for_status()
    result = r.json().get("result", {})
    by_label = result.get("entities", {})
    out = []
    for lbl in LABELS:
        for hit in by_label.get(lbl, []) or []:
            surface = hit.get("text") if isinstance(hit, dict) else str(hit)
            if surface:
                out.append({"text": surface, "label": lbl})
    return out


# -------- Metrics --------

def normalise(spans, text):
    out = set()
    for s in spans:
        surface = (s.get("text") or "").strip()
        label = s.get("label")
        if label not in LABELS or not surface:
            continue
        v = validate_span(text, surface)
        if v is None:
            continue
        out.add((v[0], v[1], label))
    return out


def per_label_f1(gold_set, pred_set, label):
    g = {(s, e) for (s, e, l) in gold_set if l == label}
    p = {(s, e) for (s, e, l) in pred_set if l == label}
    tp = len(g & p)
    fp = len(p - g)
    fn = len(g - p)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return prec, rec, f1, tp, fp, fn


# -------- Main --------

def evaluate(name, predict_fn, gold_rows):
    print(f"\n=== {name} ===")
    pred_per_example = []
    for i, row in enumerate(gold_rows):
        try:
            raw = predict_fn(row["text"])
            pred = normalise(raw, row["text"])
        except Exception as e:
            print(f"  [{i+1}] FAILED: {e}", file=sys.stderr)
            pred = set()
        pred_per_example.append(pred)
        if (i + 1) % 10 == 0:
            print(f"  [{i+1}/{len(gold_rows)}]")

    by_label = {}
    macro = []
    for lbl in LABELS:
        gold_all = set()
        pred_all = set()
        for i, row in enumerate(gold_rows):
            for s in row["spans"]:
                if s["label"] == lbl:
                    gold_all.add((i, s["start"], s["end"]))
            for (s, e, l) in pred_per_example[i]:
                if l == lbl:
                    pred_all.add((i, s, e))
        tp = len(gold_all & pred_all)
        fp = len(pred_all - gold_all)
        fn = len(gold_all - pred_all)
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        by_label[lbl] = {"P": p, "R": r, "F1": f1, "support": len(gold_all)}
        macro.append(f1)
    macro_f1 = sum(macro) / len(macro)
    return {"name": name, "by_label": by_label, "macro_f1": macro_f1}


def render_md(results):
    lines = ["# Eval Results — Inazuma Gold Test Set\n"]
    lines.append(f"Gold examples: {results['gold_count']}\n")
    lines.append("| Label | " + " | ".join(r["name"] for r in results["systems"]) + " |")
    lines.append("|---|" + "|".join("---" for _ in results["systems"]) + "|")
    for lbl in LABELS:
        row = [lbl]
        for r in results["systems"]:
            f1 = r["by_label"][lbl]["F1"]
            row.append(f"{f1:.2f}")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("| **MACRO-F1** | " + " | ".join(f"**{r['macro_f1']:.3f}**" for r in results["systems"]) + " |")
    return "\n".join(lines)


def main():
    if not GOLD_PATH.exists():
        print(f"Missing {GOLD_PATH}. Run 02_build_gold_consensus.py first.", file=sys.stderr)
        sys.exit(1)

    gold_rows = load_jsonl(GOLD_PATH)
    print(f"Gold set: {len(gold_rows)} examples")

    systems_to_run = [
        ("Pioneer GLiNER-2 (zero-shot)", pioneer_predict),
        ("Gemini 2.5-flash (frontier)", gemini_predict),
        ("Ours: Pioneer-deployed (Agent-trained)", pioneer_ft_predict),
    ]
    if OURS_URL:
        systems_to_run.append(("Ours: Modal (open gliner_large-v2.1, ours params)", ours_predict))

    results = {"gold_count": len(gold_rows), "systems": []}
    for name, fn in systems_to_run:
        results["systems"].append(evaluate(name, fn, gold_rows))

    out_md = DATA / "results" / "eval-final.md"
    out_json = DATA / "results" / "eval-final.json"
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(render_md(results))
    out_json.write_text(json.dumps(results, indent=2))

    print("\n=== HEADLINE ===")
    for r in results["systems"]:
        print(f"  {r['name']:<35} macro-F1 = {r['macro_f1']:.3f}")
    print(f"\nWrote {out_md}")
    print(f"Wrote {out_json}")


if __name__ == "__main__":
    main()
