"""Synthesize training data with Gemini 2.5-flash structured output.
Excludes any IDs reserved by the gold set (data/gold/reserved-ids.json).

Output:
  data/synth/train.jsonl  (~700 examples in GLiNER format)
  data/synth/val.jsonl    (~100 examples)
  data/synth/stats.json   (per-label counts, reject reasons)
"""
import asyncio
import json
import random
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from google import genai
from google.genai import types

from ft_common import (
    DATA,
    DATASET,
    GOOGLE_CLOUD_LOCATION,
    GOOGLE_CLOUD_PROJECT,
    LABEL_DESCRIPTIONS,
    LABELS,
    RESERVED_IDS_PATH,
    TRAIN_PATH,
    VAL_PATH,
    char_to_token_span,
    validate_span,
    whitespace_tokenize,
    write_jsonl,
)

random.seed(42)

PROMPT = """You are a precise NER annotation tool for the Inazuma.co enterprise corpus.

Find every span in TEXT matching one of these LABELS:
{labels}

RULES:
1. Each span text MUST appear verbatim in TEXT (exact substring, case-sensitive).
2. Tightest possible boundaries — no leading/trailing whitespace, no surrounding quotes.
3. Multi-token names are ONE span ("Ravi Kumar" not two).
4. Skip ambiguous mentions (e.g. "frank" as adverb is NOT CUSTOMER_ID).
5. Skip "Inazuma" / "Inazuma.co" company self-reference.
6. Skip email addresses and phone numbers.
7. Spans must NOT cross newlines.
8. Use ONLY the labels listed above.

Worked examples:
Input: "Hi Ravi Kumar (emp_1002), the customer arout requested an update on ticket 717. Please reply by 2024-12-15."
Output: {{"spans": [{{"text": "Ravi Kumar", "label": "EMPLOYEE"}}, {{"text": "emp_1002", "label": "EMPLOYEE_ID"}}, {{"text": "arout", "label": "CUSTOMER_ID"}}, {{"text": "717", "label": "TICKET_ID"}}, {{"text": "2024-12-15", "label": "DATE"}}]}}

Input: "Frankly, the team at Inazuma.co should consider whether ravi.kumar@inazuma.com receives the right messages."
Output: {{"spans": []}}

Now annotate TEXT:
\"\"\"
{text}
\"\"\"

Return JSON only with key "spans"."""

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "spans": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "text": {"type": "STRING"},
                    "label": {"type": "STRING", "enum": LABELS},
                },
                "required": ["text", "label"],
            },
        }
    },
    "required": ["spans"],
}


def gemini_client():
    if GOOGLE_CLOUD_PROJECT:
        return genai.Client(vertexai=True, project=GOOGLE_CLOUD_PROJECT, location=GOOGLE_CLOUD_LOCATION)
    return genai.Client()


def label_str():
    return "\n".join(f"- {lbl}: {LABEL_DESCRIPTIONS[lbl]}" for lbl in LABELS)


def load_json(path):
    with open(path) as f:
        return json.load(f)


def sample_snippets(reserved):
    """Build the raw snippet pool, EXCLUDING any reserved IDs."""
    snippets = []

    # 350 emails
    emails = load_json(DATASET / "Enterprise_Mail_System" / "emails.json")
    pool = [e for e in emails if e.get("thread_id") not in set(reserved.get("emails", []))]
    random.shuffle(pool)
    for e in pool[:400]:
        body = (e.get("body") or "")[:800].strip()
        if 80 <= len(body) <= 800:
            snippets.append(body)
            if sum(1 for s in snippets) >= 350:
                break

    # 250 conversations
    convs = load_json(DATASET / "Collaboration_tools" / "conversations.json")
    convs = [c for c in convs if c.get("conversation_id") not in set(reserved.get("conversations", []))]
    random.shuffle(convs)
    base = len(snippets)
    for c in convs:
        text = (c.get("text") or "")[:800].strip()
        if 80 <= len(text) <= 800:
            snippets.append(text)
            if len(snippets) - base >= 250:
                break

    # 300 ticket Issue + Resolution
    tickets = load_json(DATASET / "IT_Service_Management" / "it_tickets.json")
    tickets = [t for t in tickets if t.get("id") not in set(reserved.get("tickets", []))]
    random.shuffle(tickets)
    base = len(snippets)
    for t in tickets:
        for field in ("Issue", "Resolution"):
            txt = (t.get(field) or "")[:600].strip()
            if 80 <= len(txt) <= 600:
                snippets.append(txt)
        if len(snippets) - base >= 300:
            break

    random.shuffle(snippets)
    return snippets


_client = None


def annotate(text):
    global _client
    if _client is None:
        _client = gemini_client()
    try:
        resp = _client.models.generate_content(
            model="gemini-2.5-flash",
            contents=PROMPT.format(labels=label_str(), text=text),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=0.0,
            ),
        )
        try:
            return json.loads(resp.text).get("spans", [])
        except Exception:
            return []
    except Exception as e:
        print(f"  GEN FAILED: {e}", file=sys.stderr)
        return []


def to_gliner_format(text, raw_spans, reject_log):
    tokens, char_starts = whitespace_tokenize(text)
    ner = []
    for s in raw_spans:
        surface = (s.get("text") or "").strip()
        label = s.get("label")
        if label not in LABELS or not surface:
            reject_log["bad_label"] += 1
            continue
        v = validate_span(text, surface)
        if v is None:
            reject_log["substring_not_found_or_bad"] += 1
            continue
        ts = char_to_token_span(text, v[0], v[1], tokens, char_starts)
        if ts is None:
            reject_log["token_align_fail"] += 1
            continue
        ner.append([ts[0], ts[1], label])
    if not tokens:
        return None
    return {"tokenized_text": tokens, "ner": ner}


def main():
    if not RESERVED_IDS_PATH.exists():
        print(f"Run 01_sample_gold.py first; missing {RESERVED_IDS_PATH}", file=sys.stderr)
        sys.exit(1)
    reserved = json.loads(RESERVED_IDS_PATH.read_text())

    print(f"Sampling snippets (excluding {sum(len(v) for v in reserved.values())} reserved IDs)...")
    snippets = sample_snippets(reserved)
    print(f"Pool: {len(snippets)} snippets")

    print(f"Annotating with Gemini 2.5-flash (parallel x 8)...")
    reject_log = Counter()
    examples = []

    with ThreadPoolExecutor(max_workers=8) as ex:
        for i, (text, spans) in enumerate(zip(snippets, ex.map(annotate, snippets))):
            ex_obj = to_gliner_format(text, spans, reject_log)
            if ex_obj is not None:
                examples.append(ex_obj)
            if (i + 1) % 50 == 0:
                print(f"  [{i+1}/{len(snippets)}] valid={len(examples)} rejects={dict(reject_log)}")

    # Drop examples with zero spans (no signal; pollutes training)
    examples = [e for e in examples if e["ner"]]
    random.shuffle(examples)

    # Train/val split
    n = len(examples)
    split = int(0.88 * n)
    train, val = examples[:split], examples[split:]

    write_jsonl(TRAIN_PATH, train)
    write_jsonl(VAL_PATH, val)

    # Per-label stats
    by_label = Counter()
    for e in examples:
        for _, _, lbl in e["ner"]:
            by_label[lbl] += 1

    stats = {
        "total_snippets": len(snippets),
        "valid_examples": len(examples),
        "train": len(train),
        "val": len(val),
        "rejects": dict(reject_log),
        "by_label": dict(by_label),
    }
    (DATA / "synth").mkdir(parents=True, exist_ok=True)
    (DATA / "synth" / "stats.json").write_text(json.dumps(stats, indent=2))

    print(f"\n=== SYNTH SET BUILT ===")
    print(f"Valid examples: {len(examples)}  (train={len(train)}, val={len(val)})")
    print(f"Rejects: {dict(reject_log)}")
    print(f"Per-label train counts:")
    for lbl in LABELS:
        c = by_label[lbl]
        warn = "  ⚠ low" if c < 30 else ""
        print(f"  {lbl:<15} {c}{warn}")


if __name__ == "__main__":
    main()
