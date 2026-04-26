"""Augment gold set with templated examples that contain hard-ID labels
(CUSTOMER_ID, PRODUCT_ID, TICKET_ID, THREAD_ID, POLICY_NAME, EMPLOYEE_ID).

Templates draw from real Inazuma structured data, so entities are real,
embedded in plausible free-text sentences. Deterministic spans (no LLM
labelling needed) → 100% accurate.

Pool split: customer/product/ticket/thread IDs split 50/50 between
gold-augment and train-augment via deterministic hash, preventing leakage.

Output:
  Appends to data/gold/gold-test.jsonl
  Updates data/gold/reserved-ids.json with augmented IDs
"""
import hashlib
import json
import random
from pathlib import Path

from ft_common import DATA, DATASET, GOLD_PATH, RESERVED_IDS_PATH, load_jsonl, write_jsonl

random.seed(43)


def load_json(path):
    with open(path) as f:
        return json.load(f)


def in_gold_pool(key: str, kind: str) -> bool:
    """Deterministic 50/50 split: hash(kind + key) → first nibble even = gold."""
    h = hashlib.md5(f"{kind}:{key}".encode()).hexdigest()
    return int(h[0], 16) % 2 == 0


# Templates with placeholders. Each yields a function that produces
# (text, [{start, end, label}]) given a dict of values.
TEMPLATES = [
    # Email-ish, customer + product + amount + date
    lambda v: _build(
        f"Hi {v['emp']}, customer {v['cid']} ({v['cname']}) placed order for {v['pid']} worth {v['amt']} on {v['date']}. Please confirm.",
        [(v["emp"], "EMPLOYEE"), (v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"),
         (v["amt"], "AMOUNT"), (v["date"], "DATE")],
    ),
    # Ticket-style, employee + emp_id + dept + ticket
    lambda v: _build(
        f"Ticket {v['tid']}: {v['emp']} ({v['eid']}) from {v['dept']} reported a critical issue. Assigned on {v['date']}.",
        [(v["tid"], "TICKET_ID"), (v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID"),
         (v["dept"], "DEPARTMENT"), (v["date"], "DATE")],
    ),
    # Policy reference
    lambda v: _build(
        f"Per the {v['policy']}, all {v['dept']} records must be encrypted. {v['emp']} ({v['eid']}) confirmed compliance on {v['date']}.",
        [(v["policy"], "POLICY_NAME"), (v["dept"], "DEPARTMENT"), (v["emp"], "EMPLOYEE"),
         (v["eid"], "EMPLOYEE_ID"), (v["date"], "DATE")],
    ),
    # Thread + customer reference
    lambda v: _build(
        f"Thread {v['thread']} contains the renewal discussion with customer {v['cid']} ({v['cname']}). Last reply by {v['emp']} on {v['date']}.",
        [(v["thread"], "THREAD_ID"), (v["cid"], "CUSTOMER_ID"), (v["emp"], "EMPLOYEE"), (v["date"], "DATE")],
    ),
    # Sales summary
    lambda v: _build(
        f"Sales summary: customer {v['cid']} purchased {v['pid']} for {v['amt']} ({v['pct']} discount) on {v['date']}. Logged by {v['emp']} from {v['dept']}.",
        [(v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"), (v["amt"], "AMOUNT"),
         (v["pct"], "AMOUNT"), (v["date"], "DATE"), (v["emp"], "EMPLOYEE"), (v["dept"], "DEPARTMENT")],
    ),
    # IT resolution
    lambda v: _build(
        f"{v['emp']} ({v['eid']}) from {v['dept']} resolved ticket {v['tid']} on {v['date']}. Root cause documented.",
        [(v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID"), (v["dept"], "DEPARTMENT"),
         (v["tid"], "TICKET_ID"), (v["date"], "DATE")],
    ),
    # Cross-reference
    lambda v: _build(
        f"Following up on thread {v['thread']}: customer {v['cid']} requires {v['pid']} updated by {v['date']}. Owner: {v['emp']} ({v['eid']}).",
        [(v["thread"], "THREAD_ID"), (v["cid"], "CUSTOMER_ID"), (v["pid"], "PRODUCT_ID"),
         (v["date"], "DATE"), (v["emp"], "EMPLOYEE"), (v["eid"], "EMPLOYEE_ID")],
    ),
    # Compliance / policy + amount
    lambda v: _build(
        f"As per {v['policy']}, the {v['dept']} budget allocation of {v['amt']} for {v['date']} is approved by {v['emp']}.",
        [(v["policy"], "POLICY_NAME"), (v["dept"], "DEPARTMENT"), (v["amt"], "AMOUNT"),
         (v["date"], "DATE"), (v["emp"], "EMPLOYEE")],
    ),
]

POLICIES = [
    "Data Protection Policy",
    "Information Security Policy",
    "Acceptable Use Policy",
    "Code of Ethics",
    "Leave Policy",
    "Performance Management Policy",
    "POSH",
    "Risk Management Policy",
    "Privacy Notice Policy",
    "Compliance Policy",
]
DEPARTMENTS = ["HR", "Sales", "IT", "Business Development", "Engineering", "Marketing", "Finance"]


def _build(text: str, span_specs):
    """Compute exact char offsets by literal substring search in deterministic order.
    Each span_spec is (surface, label). Multiple instances of same surface labelled
    in order of appearance."""
    spans = []
    used_positions = set()
    for surface, label in span_specs:
        # Find next occurrence not yet claimed
        start = 0
        while True:
            idx = text.find(surface, start)
            if idx < 0:
                raise ValueError(f"Template assembly failed: '{surface}' not in '{text}'")
            end = idx + len(surface)
            if (idx, end) not in used_positions:
                used_positions.add((idx, end))
                spans.append({"start": idx, "end": end, "label": label})
                break
            start = idx + 1
    return text, spans


def main():
    customers = load_json(DATASET / "Customer_Relation_Management" / "customers.json")
    sales = load_json(DATASET / "Customer_Relation_Management" / "sales.json")
    emails = load_json(DATASET / "Enterprise_Mail_System" / "emails.json")
    tickets = load_json(DATASET / "IT_Service_Management" / "it_tickets.json")

    # Pools split by deterministic hash
    cust_gold = [c for c in customers if in_gold_pool(c["customer_id"], "cust")]
    sales_gold = [s for s in sales if in_gold_pool(s["product_id"] + str(s.get("sales_record_id", "")), "sale")]
    ticket_gold = [t for t in tickets if in_gold_pool(t["id"], "tkt")]
    thread_gold = list({e["thread_id"] for e in emails if in_gold_pool(e["thread_id"], "thr")})

    # Employee pool (from emails — names + IDs)
    employees = []
    seen = set()
    for e in emails:
        for name_key, id_key in [("sender_name", "sender_emp_id"), ("recipient_name", "recipient_emp_id")]:
            n, i = e.get(name_key), e.get(id_key)
            if n and i and i not in seen:
                seen.add(i)
                employees.append({"name": n, "id": i})

    # Need enough pools
    print(f"Pool sizes (gold-half): customers={len(cust_gold)}, sales={len(sales_gold)}, "
          f"tickets={len(ticket_gold)}, threads={len(thread_gold)}, employees={len(employees)}")

    if min(len(cust_gold), len(sales_gold), len(ticket_gold), len(thread_gold), len(employees)) < 5:
        print("Pool too small — aborting.")
        return

    augmented = []
    target_per_template = 4  # ~32 examples total
    for tmpl in TEMPLATES:
        for _ in range(target_per_template):
            cust = random.choice(cust_gold)
            sale = random.choice(sales_gold)
            tkt = random.choice(ticket_gold)
            thr = random.choice(thread_gold)
            emp = random.choice(employees)
            v = {
                "emp": emp["name"],
                "eid": emp["id"],
                "cid": cust["customer_id"],
                "cname": cust["customer_name"],
                "pid": sale["product_id"],
                "amt": sale["discounted_price"],
                "pct": sale["discount_percentage"],
                "tid": str(tkt["id"]),
                "thread": next(iter([e["thread_id"] for e in emails if e["thread_id"] == thr]), thr),
                "date": sale["Date_of_Purchase"],
                "policy": random.choice(POLICIES),
                "dept": random.choice(DEPARTMENTS),
            }
            try:
                text, spans = tmpl(v)
                augmented.append({
                    "text": text,
                    "spans": spans,
                    "source": f"template:{TEMPLATES.index(tmpl)}",
                })
            except ValueError as err:
                print(f"  skip: {err}")

    # Append to existing gold
    existing = load_jsonl(GOLD_PATH) if GOLD_PATH.exists() else []
    combined = existing + augmented
    write_jsonl(GOLD_PATH, combined)

    # Update reserved IDs
    reserved = json.loads(RESERVED_IDS_PATH.read_text()) if RESERVED_IDS_PATH.exists() else {}
    reserved.setdefault("template_customers", [])
    reserved.setdefault("template_sales", [])
    reserved.setdefault("template_tickets", [])
    reserved.setdefault("template_threads", [])
    for a in augmented:
        for s in a["spans"]:
            txt = a["text"][s["start"]:s["end"]]
            if s["label"] == "CUSTOMER_ID":
                reserved["template_customers"].append(txt)
            elif s["label"] == "TICKET_ID":
                reserved["template_tickets"].append(txt)
            elif s["label"] == "THREAD_ID":
                reserved["template_threads"].append(txt)
    RESERVED_IDS_PATH.write_text(json.dumps(reserved, indent=2))

    # Per-label updated counts
    by_label = {}
    for r in combined:
        for s in r["spans"]:
            by_label[s["label"]] = by_label.get(s["label"], 0) + 1
    print(f"\n=== AUGMENTED GOLD SET ===")
    print(f"Examples: {len(combined)} (added {len(augmented)} templated)")
    print(f"Per-label coverage:")
    for lbl in ["EMPLOYEE", "EMPLOYEE_ID", "CUSTOMER_ID", "PRODUCT_ID", "TICKET_ID",
                "THREAD_ID", "AMOUNT", "DEPARTMENT", "POLICY_NAME", "DATE"]:
        print(f"  {lbl:<15} {by_label.get(lbl, 0)}")


if __name__ == "__main__":
    main()
