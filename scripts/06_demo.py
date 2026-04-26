"""Standalone demo — call all 3 systems on one input, side-by-side."""
import json
import os
import sys

import requests

from ft_common import LABELS, PIONEER_FIELD_SPEC, PIONEER_KEY, PIONEER_URL, GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION
from google import genai
from google.genai import types


OURS_URL = os.environ.get("GLINER_FT_ENDPOINT", "")


def pioneer(text):
    body = {"task": "extract_entities", "text": text, "schema": PIONEER_FIELD_SPEC, "threshold": 0.4, "format_results": True}
    r = requests.post(PIONEER_URL, headers={"X-API-Key": PIONEER_KEY}, json=body, timeout=30)
    data = r.json().get("result", {})
    out = []
    for lbl in LABELS:
        for hit in data.get(lbl, []) or []:
            surface = hit.get("text") if isinstance(hit, dict) else str(hit)
            if surface:
                out.append((surface, lbl))
    return out


def gemini(text):
    if GOOGLE_CLOUD_PROJECT:
        c = genai.Client(vertexai=True, project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)
    else:
        c = genai.Client()
    schema = {"type":"OBJECT","properties":{"spans":{"type":"ARRAY","items":{"type":"OBJECT","properties":{"text":{"type":"STRING"},"label":{"type":"STRING","enum":LABELS}},"required":["text","label"]}}},"required":["spans"]}
    prompt = f"Extract NER spans for labels {LABELS}. Return JSON {{spans:[{{text,label}}]}}.\nText: \"\"\"{text}\"\"\""
    resp = c.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema, temperature=0.0),
    )
    try:
        return [(s["text"], s["label"]) for s in json.loads(resp.text).get("spans", [])]
    except Exception:
        return []


def ours(text):
    if not OURS_URL:
        return [("(GLINER_FT_ENDPOINT not set)", "—")]
    r = requests.post(OURS_URL, json={"text": text, "labels": LABELS, "threshold": 0.4}, timeout=30)
    return [(s.get("text", ""), s.get("label", "")) for s in r.json().get("spans", [])]


def render(name, spans):
    print(f"\n=== {name} ({len(spans)} spans) ===")
    for txt, lbl in spans:
        print(f"  [{lbl:<13}] {txt}")


def main():
    text = " ".join(sys.argv[1:]) or (
        "Hi Ravi Kumar (emp_1002), the customer arout requested an update on ticket 717. "
        "Please reply by 2024-12-15. Per the Data Protection Policy, all HR records must be encrypted."
    )
    print(f"INPUT:\n  {text}\n")
    render("Pioneer GLiNER-2 (zero-shot)", pioneer(text))
    render("Gemini 2.5-flash (frontier)", gemini(text))
    render("Ours (GLiNER-2 fine-tuned)", ours(text))


if __name__ == "__main__":
    main()
