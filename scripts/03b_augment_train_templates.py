"""Augment training data with templated examples.
Mirrors 01b_augment_gold_templates.py but uses the TRAIN-half of the ID pools
(disjoint from gold-half via deterministic hash) — no leakage.

Output:
  Appends ~150 templated examples to data/synth/train.jsonl
  Each in GLiNER tokenized format
"""
import hashlib
import json
import random
from pathlib import Path

from ft_common import (
    DATA,
    DATASET,
    LABELS,
    TRAIN_PATH,
    VAL_PATH,
    char_to_token_span,
    load_jsonl,
    whitespace_tokenize,
    write_jsonl,
)

random.seed(44)


def load_json(p):
    return json.loads(Path(p).read_text())


def in_train_pool(key: str, kind: str) -> bool:
    """Inverse of in_gold_pool — odd nibble = train."""
    h = hashlib.md5(f"{kind}:{key}".encode()).hexdigest()
    return int(h[0], 16) % 2 == 1


TEMPLATES = [
    lambda v: _build(
        f"Hi {v['emp']}, customer {v['cid']} ({v['cname']}) placed order for {v['pid']} worth {v['amt']} on {v['date']}. Please confirm.",
        [(v["emp"], "EMPLOYEE"), (v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"),
         (v["amt"], "AMOUNT"), (v["date"], "DATE")],
    ),
    lambda v: _build(
        f"Ticket {v['tid']}: {v['emp']} ({v['eid']}) from {v['dept']} reported a critical issue. Assigned on {v['date']}.",
        [(v["tid"], "TICKET_ID"), (v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID"),
         (v["dept"], "DEPARTMENT"), (v["date"], "DATE")],
    ),
    lambda v: _build(
        f"Per the {v['policy']}, all {v['dept']} records must be encrypted. {v['emp']} ({v['eid']}) confirmed compliance on {v['date']}.",
        [(v["policy"], "POLICY_NAME"), (v["dept"], "DEPARTMENT"), (v["emp"], "EMPLOYEE"),
         (v["eid"], "EMPLOYEE_ID"), (v["date"], "DATE")],
    ),
    lambda v: _build(
        f"Thread {v['thread']} contains the renewal discussion with customer {v['cid']} ({v['cname']}). Last reply by {v['emp']} on {v['date']}.",
        [(v["thread"], "THREAD_ID"), (v["cid"], "CUSTOMER_ID"), (v["emp"], "EMPLOYEE"), (v["date"], "DATE")],
    ),
    lambda v: _build(
        f"Sales summary: customer {v['cid']} purchased {v['pid']} for {v['amt']} ({v['pct']} discount) on {v['date']}. Logged by {v['emp']} from {v['dept']}.",
        [(v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"), (v["amt"], "AMOUNT"),
         (v["pct"], "AMOUNT"), (v["date"], "DATE"), (v["emp"], "EMPLOYEE"), (v["dept"], "DEPARTMENT")],
    ),
    lambda v: _build(
        f"{v['emp']} ({v['eid']}) from {v['dept']} resolved ticket {v['tid']} on {v['date']}. Root cause documented.",
        [(v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID"), (v["dept"], "DEPARTMENT"),
         (v["tid"], "TICKET_ID"), (v["date"], "DATE")],
    ),
    lambda v: _build(
        f"Following up on thread {v['thread']}: customer {v['cid']} requires {v['pid']} updated by {v['date']}. Owner: {v['emp']} ({v['eid']}).",
        [(v["thread"], "THREAD_ID"), (v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"),
         (v["date"], "DATE"), (v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID")],
    ),
    lambda v: _build(
        f"As per {v['policy']}, the {v['dept']} budget allocation of {v['amt']} for {v['date']} is approved by {v['emp']}.",
        [(v["policy"], "POLICY_NAME"), (v["dept"], "DEPARTMENT"), (v["amt"], "AMOUNT"),
         (v["date"], "DATE"), (v["emp"], "EMPLOYEE")],
    ),
    # Additional template variants for more diversity
    lambda v: _build(
        f"Quick note from {v['dept']}: customer {v['cid']} confirmed pickup of {v['pid']} on {v['date']} for {v['amt']}. CC {v['emp']}.",
        [(v["dept"], "DEPARTMENT"), (v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"),
         (v["date"], "DATE"), (v["amt"], "AMOUNT"), (v["emp"], "EMPLOYEE")],
    ),
    lambda v: _build(
        f"Reminder: {v['policy']} review due {v['date']}. {v['emp']} from {v['dept']} owns the rollout.",
        [(v["policy"], "POLICY_NAME"), (v["date"], "DATE"), (v["emp"], "EMPLOYEE"), (v["dept"], "DEPARTMENT")],
    ),
    lambda v: _build(
        f"Order recap: {v['cid']} ({v['cname']}) bought {v['pid']} at {v['amt']} on {v['date']}; ticket {v['tid']} for follow-up.",
        [(v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"), (v["amt"], "AMOUNT"),
         (v["date"], "DATE"), (v["tid"], "TICKET_ID")],
    ),
    lambda v: _build(
        f"{v['emp']} ({v['eid']}) escalated ticket {v['tid']} to {v['dept']} on {v['date']}. Customer {v['cid']} is awaiting reply.",
        [(v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID"), (v["tid"], "TICKET_ID"),
         (v["dept"], "DEPARTMENT"), (v["date"], "DATE"), (v["cid"], "CUSTOMER_ID")],
    ),
]

POLICIES = [
    "Data Protection Policy", "Information Security Policy", "Acceptable Use Policy",
    "Code of Ethics", "Leave Policy", "Performance Management Policy", "POSH",
    "Risk Management Policy", "Privacy Notice Policy", "Compliance Policy",
    "Companies Act Policy", "Employee Handbook", "Software Development Lifecycle",
    "Medical Insurance Policy",
]
DEPARTMENTS = ["HR", "Sales", "IT", "Business Development", "Engineering",
               "Marketing", "Finance", "Operations", "Legal", "Procurement"]


def _build(text, span_specs):
    spans = []
    used = set()
    for surface, label in span_specs:
        start = 0
        while True:
            idx = text.find(surface, start)
            if idx < 0:
                raise ValueError(f"surface '{surface}' missing")
            end = idx + len(surface)
            if (idx, end) not in used:
                used.add((idx, end))
                spans.append((idx, end, label))
                break
            start = idx + 1
    return text, spans


def to_gliner(text, char_spans):
    tokens, char_starts = whitespace_tokenize(text)
    ner = []
    for char_start, char_end, label in char_spans:
        ts = char_to_token_span(text, char_start, char_end, tokens, char_starts)
        if ts is None:
            return None
        ner.append([ts[0], ts[1], label])
    return {"tokenized_text": tokens, "ner": ner}


def main():
    customers = load_json(DATASET / "Customer_Relation_Management" / "customers.json")
    sales = load_json(DATASET / "Customer_Relation_Management" / "sales.json")
    emails = load_json(DATASET / "Enterprise_Mail_System" / "emails.json")
    tickets = load_json(DATASET / "IT_Service_Management" / "it_tickets.json")

    cust_train = [c for c in customers if in_train_pool(c["customer_id"], "cust")]
    sales_train = [s for s in sales if in_train_pool(s["product_id"] + str(s.get("sales_record_id", "")), "sale")]
    ticket_train = [t for t in tickets if in_train_pool(t["id"], "tkt")]
    thread_train = list({e["thread_id"] for e in emails if in_train_pool(e["thread_id"], "thr")})

    employees = []
    seen = set()
    for e in emails:
        for n_k, i_k in [("sender_name", "sender_emp_id"), ("recipient_name", "recipient_emp_id")]:
            n, i = e.get(n_k), e.get(i_k)
            if n and i and i not in seen:
                seen.add(i)
                employees.append({"name": n, "id": i})

    print(f"Train pools: customers={len(cust_train)}, sales={len(sales_train)}, "
          f"tickets={len(ticket_train)}, threads={len(thread_train)}, employees={len(employees)}")

    examples = []
    target_per_template = 15  # 15 * 12 templates = 180 examples
    for tmpl in TEMPLATES:
        for _ in range(target_per_template):
            cust = random.choice(cust_train)
            sale = random.choice(sales_train)
            tkt = random.choice(ticket_train)
            thr = random.choice(thread_train)
            emp = random.choice(employees)
            v = {
                "emp": emp["name"], "eid": emp["id"],
                "cid": cust["customer_id"], "cname": cust["customer_name"],
                "pid": sale["product_id"], "amt": sale["discounted_price"],
                "pct": sale["discount_percentage"],
                "tid": str(tkt["id"]), "thread": thr,
                "date": sale["Date_of_Purchase"],
                "policy": random.choice(POLICIES),
                "dept": random.choice(DEPARTMENTS),
            }
            try:
                text, spans = tmpl(v)
                ex = to_gliner(text, spans)
                if ex:
                    examples.append(ex)
            except Exception as e:
                pass

    random.shuffle(examples)
    n = len(examples)
    train_aug = examples[: int(0.9 * n)]
    val_aug = examples[int(0.9 * n):]

    # Append to existing
    existing_train = load_jsonl(TRAIN_PATH) if TRAIN_PATH.exists() else []
    existing_val = load_jsonl(VAL_PATH) if VAL_PATH.exists() else []
    write_jsonl(TRAIN_PATH, existing_train + train_aug)
    write_jsonl(VAL_PATH, existing_val + val_aug)

    # Stats
    by_label = {}
    for e in examples:
        for _, _, lbl in e["ner"]:
            by_label[lbl] = by_label.get(lbl, 0) + 1
    print(f"\n=== TEMPLATED TRAIN AUGMENTATION ===")
    print(f"Added: train+={len(train_aug)}, val+={len(val_aug)}")
    print(f"Total train now: {len(existing_train) + len(train_aug)}")
    print(f"Total val now: {len(existing_val) + len(val_aug)}")
    print(f"Per-label spans in augmentation:")
    for lbl in LABELS:
        print(f"  {lbl:<15} {by_label.get(lbl, 0)}")


if __name__ == "__main__":
    main()
