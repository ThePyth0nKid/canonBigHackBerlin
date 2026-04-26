"""Convert GLiNER-format train.jsonl + val.jsonl → Pioneer NER format.

Pioneer expects:
  {"text": "...", "entities": [{"entity": "<LABEL>", "value": "<surface>"}]}

GLiNER source:
  {"tokenized_text": [...tokens], "ner": [[tok_start, tok_end, label]]}

Reconstructs text by joining tokens with spaces (loses original whitespace
but Pioneer's GLiNER-2 tokenises on spaces internally so this matches their
training pipeline assumptions).

Output:
  data/synth/pioneer-train.jsonl
  data/synth/pioneer-val.jsonl
  data/synth/pioneer-combined.jsonl  (for upload)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ft_common import LABELS, REPO, load_jsonl, write_jsonl


def detok(tokens):
    """Re-join tokens — naive: space between most, no space before punctuation."""
    out = []
    for i, t in enumerate(tokens):
        if i == 0:
            out.append(t)
        elif t in ".,;:!?)]}":
            out.append(t)
        elif out[-1] in "([{":
            out.append(t)
        else:
            out.append(" " + t)
    return "".join(out)


def to_pioneer(row):
    """Pioneer NER format: {text, entities: [[surface_text, ENTITY_TYPE], ...]}"""
    tokens = row["tokenized_text"]
    text = detok(tokens)
    entities = []
    for entry in row.get("ner", []):
        if len(entry) < 3:
            continue
        ts, te, label = entry[0], entry[1], entry[2]
        if label not in LABELS:
            continue
        if ts < 0 or te >= len(tokens) or te < ts:
            continue
        value = detok(tokens[ts:te + 1]).strip()
        if not value or value not in text:
            continue
        entities.append([value, label])
    return {"text": text, "entities": entities}


def main():
    train_in = REPO / "data" / "synth" / "train.jsonl"
    val_in = REPO / "data" / "synth" / "val.jsonl"
    train_out = REPO / "data" / "synth" / "pioneer-train.jsonl"
    val_out = REPO / "data" / "synth" / "pioneer-val.jsonl"
    combined_out = REPO / "data" / "synth" / "pioneer-combined.jsonl"

    train = [to_pioneer(r) for r in load_jsonl(train_in)]
    val = [to_pioneer(r) for r in load_jsonl(val_in)]

    # Filter rows with at least 1 entity (Pioneer rejects empty)
    train = [r for r in train if r["entities"]]
    val = [r for r in val if r["entities"]]

    write_jsonl(train_out, train)
    write_jsonl(val_out, val)
    write_jsonl(combined_out, train + val)

    print(f"Pioneer-format files:")
    print(f"  train: {len(train)} rows → {train_out}")
    print(f"  val:   {len(val)} rows → {val_out}")
    print(f"  combined: {len(train) + len(val)} rows → {combined_out}")
    print(f"\nSample:")
    print(json.dumps(train[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
