/**
 * Canon — Single source of truth for fact-shaped types.
 * Mirrors prisma/schema.prisma · FactEvent (and the not-yet-persisted
 * Redaction/Resolution events that ride on the same hash-chain).
 */

export type Entity = string;

/** Pre-sign extraction output. NOT persisted directly. */
export interface FactDraft {
  /** Lowercase entity slug, e.g. "northwind" | "acme" | "techco". */
  entity: Entity;
  /** One-sentence factual statement. */
  claim: string;
  /** Optional structured metric pulled out of the claim. */
  metric?: { key: string; value: string; unit?: string };
  /** Stable per-source pointer; e.g. "slack:C0B058UN0PK:1713600000.000100". */
  sourceRef: string;
  /** 1-2 lines of original text for citation in the UI. */
  sourceExcerpt: string;
  /** ISO timestamp of when the source produced this content. */
  observedAt: string;
}

export type SourceKind = 'slack' | 'gmail' | 'pdf';

/** Persisted, signed fact (post-pipeline). Matches Prisma FactEvent row. */
export interface FactEvent {
  id: string;
  userId: string;
  entity: Entity;
  claim: string;
  sourceRef: string;
  sourceExcerpt: string | null;
  parentHash: string | null;
  eventHash: string;
  coseSign1Hex: string;
  signerPubkey: string;
  signedAt: Date;
  /** "active" | "redacted" | "superseded" | "conflict" */
  status: FactStatus;
  createdAt: Date;
}

export type FactStatus = 'active' | 'redacted' | 'superseded' | 'conflict';

/**
 * Emitted when scan refuses to canonize a draft (PII / secret).
 * Same hash-chain shape as FactEvent — claim is `<redacted>`.
 */
export interface RedactionEvent extends Omit<FactEvent, 'status'> {
  status: 'redacted';
  /** Why the scanner refused; e.g. "secret:aws_access_key" | "pii:iban". */
  redactionReason: string;
}

/**
 * Emitted when a user (or auto-policy) picks one of multiple competing claims.
 * Itself signed — the resolution is part of the audit chain.
 */
export interface ResolutionEvent {
  id: string;
  userId: string;
  entity: Entity;
  /** The claim-key under which competing facts grouped. */
  claimKey: string;
  /** Hash of the FactEvent the resolver picked as truth. */
  pickedFactHash: string;
  /** Hashes of the competing facts that were superseded. */
  supersededFactHashes: string[];
  /** "human" | "policy:recency" | "policy:source-precedence". */
  reason: string;
  parentHash: string | null;
  eventHash: string;
  coseSign1Hex: string;
  signerPubkey: string;
  signedAt: Date;
}
