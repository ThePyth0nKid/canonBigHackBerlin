"""Tri-model consensus gold labelling.
For each snippet, run Pioneer GLiNER-2, Gemini 2.5-flash, and Claude Opus 4.7
independently. Spans agreed by >=2 of 3 become gold. Disagreements are resolved
by Claude with explicit reasoning, saved to a reasoning trail.

Output:
  data/gold/gold-test.jsonl  (50 examples in canonical format)
  data/gold/reasoning-trail.jsonl  (audit log per disagreement)
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import requests
from anthropic import Anthropic
from google import genai
from google.genai import types

from ft_common import (
    ANTHROPIC_KEY,
    DATA,
    GOLD_PATH,
    GOOGLE_CLOUD_LOCATION,
    GOOGLE_CLOUD_PROJECT,
    LABEL_DESCRIPTIONS,
    LABELS,
    PIONEER_FIELD_SPEC,
    PIONEER_KEY,
    PIONEER_URL,
    load_jsonl,
    validate_span,
    write_jsonl,
)

PROMPT = """You are a precise NER annotation tool for the Inazuma.co enterprise corpus.

Find every span in TEXT that matches one of these LABELS:
{labels}

RULES:
1. Each span text MUST appear verbatim in TEXT (exact substring, case-sensitive).
2. Tightest possible boundaries — no leading/trailing whitespace, no surrounding quotes.
3. Multi-token names are ONE span ("Ravi Kumar" not two).
4. Skip ambiguous mentions (e.g. "frank" as adverb is NOT CUSTOMER_ID).
5. Skip "Inazuma" / "Inazuma.co" company self-reference (we exclude ORG).
6. Skip email addresses and phone numbers (we exclude those labels).
7. Spans must NOT cross newlines.
8. Use ONLY the labels listed above.

WORKED EXAMPLES:

Example 1 input:
"Hi Ravi Kumar (emp_1002), the customer arout requested an update on ticket 717. Please reply by 2024-12-15."
Output:
{{"spans": [{{"text": "Ravi Kumar", "label": "EMPLOYEE"}}, {{"text": "emp_1002", "label": "EMPLOYEE_ID"}}, {{"text": "arout", "label": "CUSTOMER_ID"}}, {{"text": "717", "label": "TICKET_ID"}}, {{"text": "2024-12-15", "label": "DATE"}}]}}

Example 2 input:
"Per the Data Protection Policy, all HR records must be encrypted. Aji Joseph (HR) confirmed compliance on 2026-04-01."
Output:
{{"spans": [{{"text": "Data Protection Policy", "label": "POLICY_NAME"}}, {{"text": "HR", "label": "DEPARTMENT"}}, {{"text": "Aji Joseph", "label": "EMPLOYEE"}}, {{"text": "HR", "label": "DEPARTMENT"}}, {{"text": "2026-04-01", "label": "DATE"}}]}}

Example 3 input (showing what NOT to label):
"Frankly, the team at Inazuma.co should consider whether ravi.kumar@inazuma.com receives the right messages."
Output:
{{"spans": []}}

Now annotate this TEXT:
\"\"\"
{text}
\"\"\"

Return JSON only with key "spans"."""


def label_str():
    return "\n".join(f"- {lbl}: {LABEL_DESCRIPTIONS[lbl]}" for lbl in LABELS)


# ---------- Pioneer ----------

def pioneer_label(text: str):
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
    spans = []
    for lbl in LABELS:
        for hit in by_label.get(lbl, []) or []:
            surface = hit.get("text") if isinstance(hit, dict) else str(hit)
            if surface:
                spans.append({"text": surface, "label": lbl})
    return spans


# ---------- Gemini ----------

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


_gemini = None


def gemini_label(text: str):
    global _gemini
    if _gemini is None:
        _gemini = gemini_client()
    prompt = PROMPT.format(labels=label_str(), text=text)
    resp = _gemini.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
            temperature=0.0,
        ),
    )
    try:
        data = json.loads(resp.text)
    except Exception:
        return []
    return data.get("spans", [])


# ---------- Claude ----------

_claude = None


def claude_label(text: str):
    global _claude
    if _claude is None:
        _claude = Anthropic(api_key=ANTHROPIC_KEY)
    prompt = PROMPT.format(labels=label_str(), text=text)
    msg = _claude.messages.create(
        model="claude-opus-4-5",
        max_tokens=2000,
        temperature=0.0,
        messages=[{"role": "user", "content": prompt + "\n\nReturn ONLY the JSON, no prose."}],
    )  # claude-opus-4-5 deliberately — most recent stable; 4-7 not yet on api endpoint everywhere
    text_out = "".join(b.text for b in msg.content if b.type == "text").strip()
    if text_out.startswith("```"):
        text_out = text_out.split("```", 2)[1]
        if text_out.startswith("json"):
            text_out = text_out[4:]
    try:
        data = json.loads(text_out)
    except Exception:
        return []
    return data.get("spans", [])


# ---------- Consensus ----------

def normalise(spans, text):
    """Convert {text,label} → set of (start, end, label) using validated offsets."""
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


def consensus(per_model_spans):
    """Return spans agreed by >=2 of 3 models, plus disagreements."""
    all_spans = set()
    for spans in per_model_spans.values():
        all_spans |= spans
    agreed = set()
    disagreed = []
    for span in all_spans:
        votes = sum(1 for spans in per_model_spans.values() if span in spans)
        if votes >= 2:
            agreed.add(span)
        else:
            voters = [m for m, spans in per_model_spans.items() if span in spans]
            disagreed.append({"span": span, "voters": voters})
    return agreed, disagreed


def claude_resolve(text: str, disagreed: list):
    """For each disagreement, ask Claude: include or exclude?"""
    if not disagreed:
        return [], []
    global _claude
    if _claude is None:
        _claude = Anthropic(api_key=ANTHROPIC_KEY)

    span_lines = []
    for i, d in enumerate(disagreed):
        s, e, lbl = d["span"]
        surface = text[s:e]
        voters = ", ".join(d["voters"])
        span_lines.append(f"{i}. [{lbl}] '{surface}' (proposed by: {voters})")

    prompt = f"""You are resolving NER annotation disagreements on this text.

TEXT:
\"\"\"
{text}
\"\"\"

PROPOSED SPANS (each proposed by 1 of 3 models):
{chr(10).join(span_lines)}

For each, decide INCLUDE (correct annotation per the schema) or EXCLUDE (not a valid span).
Schema rules:
- EMPLOYEE: full name of Inazuma employee
- EMPLOYEE_ID: token like emp_1002
- CUSTOMER_ID: 5-letter lowercase customer slug, only when context implies customer
- PRODUCT_ID: like B07JW9H4J1
- TICKET_ID: numeric, only in ticket context
- THREAD_ID: like THR_20241104_d2b538
- AMOUNT: monetary with currency or %
- DEPARTMENT: HR, Sales, IT, etc. — only Inazuma org units
- POLICY_NAME: name of Inazuma policy
- DATE: calendar date

Return JSON: {{"decisions": [{{"index": 0, "verdict": "INCLUDE"|"EXCLUDE", "reason": "..."}}]}}
"""
    msg = _claude.messages.create(
        model="claude-opus-4-5",
        max_tokens=3000,
        temperature=0.0,
        messages=[{"role": "user", "content": prompt}],
    )
    text_out = "".join(b.text for b in msg.content if b.type == "text").strip()
    if text_out.startswith("```"):
        text_out = text_out.split("```", 2)[1]
        if text_out.startswith("json"):
            text_out = text_out[4:]
    try:
        data = json.loads(text_out)
        decisions = data.get("decisions", [])
    except Exception:
        decisions = []
    included = []
    trail = []
    for d in decisions:
        i = d.get("index")
        if i is None or i >= len(disagreed):
            continue
        span = disagreed[i]["span"]
        verdict = d.get("verdict", "EXCLUDE")
        trail.append({"span": list(span), "surface": text[span[0]:span[1]], "voters": disagreed[i]["voters"], "verdict": verdict, "reason": d.get("reason", "")})
        if verdict == "INCLUDE":
            included.append(span)
    return included, trail


def main():
    raw_path = DATA / "gold" / "raw-snippets.jsonl"
    if not raw_path.exists():
        print(f"Run 01_sample_gold.py first; missing {raw_path}", file=sys.stderr)
        sys.exit(1)

    snippets = load_jsonl(raw_path)
    print(f"Building tri-model consensus on {len(snippets)} snippets...")

    gold_rows = []
    trail_rows = []

    for i, snip in enumerate(snippets):
        text = snip["text"]
        print(f"\n[{i+1}/{len(snippets)}] {snip['source']}")

        per_model = {}
        for name, fn in [("pioneer", pioneer_label), ("gemini", gemini_label), ("claude", claude_label)]:
            try:
                raw = fn(text)
                norm = normalise(raw, text)
                per_model[name] = norm
                print(f"  {name:<8} -> {len(norm)} spans")
            except Exception as e:
                print(f"  {name:<8} FAILED: {e}", file=sys.stderr)
                per_model[name] = set()

        agreed, disagreed = consensus(per_model)
        print(f"  agreed (>=2/3): {len(agreed)}, disagreements: {len(disagreed)}")

        resolved, trail = claude_resolve(text, disagreed) if disagreed else ([], [])
        final_spans = sorted(agreed | set(resolved))
        print(f"  final gold spans: {len(final_spans)}  (resolved {sum(1 for t in trail if t['verdict']=='INCLUDE')}/{len(disagreed)} disagreements)")

        gold_rows.append({
            "text": text,
            "spans": [{"start": s, "end": e, "label": lbl} for (s, e, lbl) in final_spans],
            "source": snip["source"],
        })
        trail_rows.extend([{"snippet_idx": i, "source": snip["source"], **t} for t in trail])

    write_jsonl(GOLD_PATH, gold_rows)
    write_jsonl(DATA / "gold" / "reasoning-trail.jsonl", trail_rows)

    total_spans = sum(len(r["spans"]) for r in gold_rows)
    by_label = {}
    for r in gold_rows:
        for s in r["spans"]:
            by_label[s["label"]] = by_label.get(s["label"], 0) + 1

    print(f"\n=== GOLD SET BUILT ===")
    print(f"Examples: {len(gold_rows)}")
    print(f"Total spans: {total_spans}")
    print(f"Per-label coverage:")
    for lbl in LABELS:
        print(f"  {lbl:<15} {by_label.get(lbl, 0)}")
    print(f"\nGold path: {GOLD_PATH}")
    print(f"Reasoning trail: {DATA / 'gold' / 'reasoning-trail.jsonl'}")


if __name__ == "__main__":
    main()
