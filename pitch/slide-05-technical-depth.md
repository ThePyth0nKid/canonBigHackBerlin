# Slide 5 — Technical depth (proof)

**Title:** Tamper-proof. Offline-checkable.

## On screen (≤60 words)

```
COSE_Sign1 envelope (hex):
  d28443a10127a0586b...8eb2a4f1c3...

Ed25519 pubkey (kid):
  3f9c4e2a...d7b1

$ canon-verify event.cose
  { verified: true,
    eventHash: "9b1f...",
    parentHash: "8a0e...",
    kid:        "3f9c4e2a...",
    signedAt:   "2026-04-25T13:42Z" }
```

- Different binary verifies — independent of Canon
- Offline-checkable — no network, pinned pubkey
- Tamper-proof — break the chain, verify fails
- Any agent can pin the pubkey and read facts directly

## Speaker notes (≤90 words, ~13s)

"Für die, die's genau wissen wollen. Jeder Fact ist ein COSE-Sign1-Envelope, Ed25519-signiert, hash-chained an den parent. Canon-verify ist eine separate Binary — anderes Repo, andere Sprache, kein Trust in Canon nötig. Du pinnst den Pubkey, du verifizierst offline. Brichst du die Chain, fällt der Verify. Jeder Agent kann das. Das ist nicht 'AI rät' — das ist provable provenance."

## Stage cue

Optional click into "View proof" modal in /app to show the actual hex envelope live. If short on time, leave the slide static.
