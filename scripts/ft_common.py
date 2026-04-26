"""Shared constants and helpers for the Pioneer/GLiNER fine-tune sprint."""
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env")

REPO = Path(__file__).resolve().parent.parent
DATASET = Path("/Users/nelsonmehlis/Downloads/Dataset")
DATA = REPO / "data"
GOLD_PATH = DATA / "gold" / "gold-test.jsonl"
TRAIN_PATH = DATA / "synth" / "train.jsonl"
VAL_PATH = DATA / "synth" / "val.jsonl"
RESERVED_IDS_PATH = DATA / "gold" / "reserved-ids.json"

LABELS = [
    "EMPLOYEE",
    "EMPLOYEE_ID",
    "CUSTOMER_ID",
    "PRODUCT_ID",
    "TICKET_ID",
    "THREAD_ID",
    "AMOUNT",
    "DEPARTMENT",
    "POLICY_NAME",
    "DATE",
]

LABEL_DESCRIPTIONS = {
    "EMPLOYEE": "Inazuma employee full name (e.g. 'Ravi Kumar', 'Aarav Mittal'). Multi-token names are ONE span. Exclude titles and possessives.",
    "EMPLOYEE_ID": "Token of the form emp_NNNN (e.g. 'emp_1002').",
    "CUSTOMER_ID": "5-letter lowercase customer slug (e.g. 'arout', 'queen', 'folko'). Only label when context implies customer reference, NOT when used as common English word.",
    "PRODUCT_ID": "Amazon-style alphanumeric product code (e.g. 'B07JW9H4J1').",
    "TICKET_ID": "Numeric IT ticket identifier (e.g. '717', '900'). Only when context says ticket; bare numbers in other contexts are NOT TICKET_ID.",
    "THREAD_ID": "Email thread identifier (e.g. 'THR_20241104_d2b538').",
    "AMOUNT": "Monetary amount with currency symbol/code, or percentage (e.g. '₹399', '₹1,099', '64%'). Include currency symbol; exclude leading/trailing whitespace.",
    "DEPARTMENT": "Inazuma organisational unit (e.g. 'HR', 'Sales', 'IT', 'Business Development').",
    "POLICY_NAME": "Name of an Inazuma policy document (e.g. 'Data Protection Policy', 'POSH', 'Code of Ethics').",
    "DATE": "Calendar date (e.g. '2012-03-18', 'next Wednesday'). For datetime strings, label only the date portion.",
}

PIONEER_KEY = os.environ["PIONEER_API_KEY"]
PIONEER_URL = "https://api.pioneer.ai/gliner-2"

ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")


def load_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path, rows):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def whitespace_tokenize(text):
    tokens = []
    char_starts = []
    for match in re.finditer(r"\S+", text):
        tok = match.group(0)
        sub_start = match.start()
        for sub in re.finditer(r"[\wÀ-ſऀ-ॿ]+|[^\w\s]", tok):
            tokens.append(sub.group(0))
            char_starts.append(sub_start + sub.start())
    return tokens, char_starts


def char_to_token_span(text, char_start, char_end, tokens, char_starts):
    tok_start = None
    tok_end = None
    for i, cs in enumerate(char_starts):
        if cs == char_start:
            tok_start = i
        ce = cs + len(tokens[i])
        if ce == char_end:
            tok_end = i
        if tok_start is not None and tok_end is not None and tok_end >= tok_start:
            return tok_start, tok_end
    return None


def validate_span(text, surface):
    if not surface or not surface.strip():
        return None
    if "\n" in surface:
        return None
    if not (1 <= len(surface) <= 80):
        return None
    idx = text.find(surface)
    if idx < 0:
        return None
    return idx, idx + len(surface)
