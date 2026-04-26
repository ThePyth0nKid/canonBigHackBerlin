"""Sample 50 gold-test snippets from Inazuma corpus.
Reserves their parent IDs (thread_id, conversation_id, ticket id, post id) so that
synthetic data generation can exclude them — preventing train/test leakage.

Output:
  data/gold/raw-snippets.jsonl  (50 raw texts + source metadata)
  data/gold/reserved-ids.json   (set of IDs to exclude from training)
"""
import json
import random
from pathlib import Path

from ft_common import DATA, DATASET, RESERVED_IDS_PATH, write_jsonl

random.seed(42)


def load_json(path):
    with open(path) as f:
        return json.load(f)


def main():
    snippets = []
    reserved = {"emails": [], "conversations": [], "tickets": [], "posts": []}

    # 15 emails by unique thread_id
    emails = load_json(DATASET / "Enterprise_Mail_System" / "emails.json")
    by_thread = {}
    for e in emails:
        by_thread.setdefault(e["thread_id"], []).append(e)
    thread_ids = list(by_thread.keys())
    random.shuffle(thread_ids)
    for tid in thread_ids[:15]:
        e = by_thread[tid][0]
        body = (e.get("body") or "")[:800].strip()
        if len(body) < 50:
            continue
        snippets.append({"text": body, "source": f"email:{e['email_id']}", "thread_id": tid})
        reserved["emails"].append(tid)

    # 15 conversations by unique conversation_id
    convs = load_json(DATASET / "Collaboration_tools" / "conversations.json")
    random.shuffle(convs)
    for c in convs[:15]:
        text = (c.get("text") or "")[:800].strip()
        if len(text) < 50:
            continue
        snippets.append({"text": text, "source": f"conversation:{c['conversation_id']}", "conversation_id": c["conversation_id"]})
        reserved["conversations"].append(c["conversation_id"])

    # 10 ticket Issues + 5 ticket Resolutions
    tickets = load_json(DATASET / "IT_Service_Management" / "it_tickets.json")
    random.shuffle(tickets)
    issue_count = 0
    res_count = 0
    for t in tickets:
        if issue_count < 10 and t.get("Issue"):
            issue = t["Issue"][:600].strip()
            if len(issue) >= 50:
                snippets.append({"text": issue, "source": f"ticket:{t['id']}:issue", "ticket_id": t["id"]})
                reserved["tickets"].append(t["id"])
                issue_count += 1
        elif res_count < 5 and t.get("Resolution"):
            res = t["Resolution"][:600].strip()
            if len(res) >= 50:
                snippets.append({"text": res, "source": f"ticket:{t['id']}:resolution", "ticket_id": t["id"]})
                reserved["tickets"].append(t["id"])
                res_count += 1
        if issue_count >= 10 and res_count >= 5:
            break

    # 5 posts
    posts_path = DATASET / "Enterprise_Social_Platform" / "posts.json"
    if posts_path.exists():
        posts = load_json(posts_path)
        random.shuffle(posts)
        for p in posts[:20]:
            text_field = p.get("text") or p.get("content") or p.get("body") or ""
            text = text_field[:600].strip()
            if len(text) < 50:
                continue
            pid = p.get("post_id") or p.get("id") or "?"
            snippets.append({"text": text, "source": f"post:{pid}", "post_id": pid})
            reserved["posts"].append(pid)
            if sum(1 for s in snippets if s["source"].startswith("post:")) >= 5:
                break

    print(f"Sampled {len(snippets)} gold candidates:")
    for src_prefix in ["email:", "conversation:", "ticket:", "post:"]:
        count = sum(1 for s in snippets if s["source"].startswith(src_prefix))
        print(f"  {src_prefix:<15} {count}")

    out_path = DATA / "gold" / "raw-snippets.jsonl"
    write_jsonl(out_path, snippets)
    print(f"\nWrote {out_path}")

    RESERVED_IDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RESERVED_IDS_PATH, "w") as f:
        json.dump(reserved, f, indent=2)
    print(f"Wrote {RESERVED_IDS_PATH}")
    print(f"Reserved: {sum(len(v) for v in reserved.values())} IDs")


if __name__ == "__main__":
    main()
