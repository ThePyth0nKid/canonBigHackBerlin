'use client';

import { useEffect, useState } from 'react';
import type { FactRow } from '@/lib/canon/view';

export function ProofButton({ fact }: { fact: FactRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        view proof
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </button>
      {open && <ProofModal fact={fact} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The "vault" modal — dark-only, color-segmented COSE_Sign1 hex,
 * full-width Verify CTA bar. Drama for the on-stage punchline.
 */
function ProofModal({ fact, onClose }: { fact: FactRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Color-segment the COSE hex for "real cryptography" feel:
  // first 8 bytes = protected header, last 64 bytes = signature, middle = payload.
  const hex = fact.coseSign1Hex;
  const headerLen = Math.min(16, hex.length);
  const sigLen = Math.min(128, Math.max(0, hex.length - headerLen));
  const headerHex = hex.slice(0, headerLen);
  const payloadHex = hex.slice(headerLen, hex.length - sigLen);
  const signatureHex = hex.slice(hex.length - sigLen);
  const byteCount = Math.floor(hex.length / 2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 py-12 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl ring-1 ring-emerald-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 px-6 py-5">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400">
              FactEvent · {fact.status}
            </p>
            <h2 className="mt-1.5 truncate text-lg font-semibold text-zinc-50">
              {fact.claim}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 text-2xl leading-none text-zinc-500 hover:text-zinc-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Primary metadata grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-zinc-800 px-6 py-5">
          <Field label="Entity" value={fact.entity} mono />
          <Field
            label="Metric"
            value={
              fact.metricKey
                ? `${fact.metricKey} = ${fact.metricValue ?? '?'}${fact.metricUnit ?? ''}`
                : '—'
            }
            mono
          />
          <Field
            label="Source"
            value={fact.sourceRef}
            mono
            className="col-span-2 truncate"
          />
          {fact.sourceExcerpt && (
            <div className="col-span-2 rounded-md border-l-2 border-emerald-500/60 bg-zinc-900/60 px-3 py-2">
              <p className="text-xs italic leading-relaxed text-zinc-300">
                "{fact.sourceExcerpt}"
              </p>
            </div>
          )}
        </div>

        {/* Chain metadata — denser */}
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 border-b border-zinc-800 px-6 py-4 font-mono text-[11px]">
          <ChainRow label="signed" value={fact.signedAt.toISOString()} />
          {fact.observedAt && (
            <ChainRow label="observed" value={fact.observedAt.toISOString()} />
          )}
          <ChainRow label="pubkey" value={fact.signerPubkey} truncate />
          <ChainRow
            label="parent"
            value={fact.parentHash ?? '— genesis'}
            truncate
            dim={!fact.parentHash}
          />
          <ChainRow
            label="event"
            value={fact.eventHash}
            truncate
            emerald
            arrow
          />
          {fact.notes && <ChainRow label="notes" value={fact.notes} />}
        </dl>

        {/* COSE_Sign1 hex vault */}
        <div className="border-b border-zinc-800 px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              COSE_Sign1 · {byteCount} bytes
            </span>
            <CopyButton value={hex} />
          </div>
          <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-black p-3 font-mono text-[10px] leading-relaxed tracking-[0.02em]">
            <span className="text-zinc-500">{headerHex}</span>
            <span className="text-zinc-300">{payloadHex}</span>
            <span className="text-emerald-400">{signatureHex}</span>
          </pre>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
            <Legend dot="bg-zinc-500">header</Legend>
            <Legend dot="bg-zinc-300">payload</Legend>
            <Legend dot="bg-emerald-400">signature</Legend>
          </div>
        </div>

        {/* Verify CTA — the punchline */}
        <div className="px-6 py-5">
          <VerifyBar factId={fact.id} />
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            Verified by{' '}
            <code className="font-mono text-zinc-400">canon-verify</code> — a
            separate binary from the signer. Tamper any byte and the signature
            fails. The pubkey above is what an external agent pins.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  className = '',
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </dt>
      <dd className={`mt-1 text-sm text-zinc-100 ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function ChainRow({
  label,
  value,
  truncate,
  emerald,
  dim,
  arrow,
}: {
  label: string;
  value: string;
  truncate?: boolean;
  emerald?: boolean;
  dim?: boolean;
  arrow?: boolean;
}) {
  return (
    <>
      <dt className="uppercase tracking-wider text-zinc-500">
        {arrow && <span className="mr-1 text-emerald-500">↳</span>}
        {label}
      </dt>
      <dd
        className={`${truncate ? 'truncate' : ''} ${
          dim ? 'text-zinc-600' : emerald ? 'text-emerald-400' : 'text-zinc-300'
        }`}
      >
        {value}
      </dd>
    </>
  );
}

function Legend({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span>
      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${dot}`} />
      {children}
    </span>
  );
}

interface VerifyResp {
  verified: boolean;
  eventHash?: string;
  kid?: string;
  error?: string;
  latencyMs?: number;
}

function VerifyBar({ factId }: { factId: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerifyResp | null>(null);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        setResult(null);
        try {
          const res = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ factId }),
          });
          const data = (await res.json()) as VerifyResp;
          setResult(data);
        } catch (e) {
          setResult({ verified: false, error: (e as Error).message });
        } finally {
          setPending(false);
        }
      }}
      className={`group flex h-12 w-full items-center justify-center gap-3 rounded-lg border text-sm font-medium transition-all ${
        result?.verified
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
          : result && !result.verified
            ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
            : 'border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-emerald-500/50 hover:bg-emerald-500/5'
      }`}
    >
      {pending ? (
        <>
          <Spinner /> verifying signature…
        </>
      ) : result?.verified ? (
        <>
          <BigCheck /> <span>verified</span>
          <span className="font-mono text-xs text-emerald-400/70">
            · {result.latencyMs}ms
          </span>
        </>
      ) : result ? (
        <>✗ {result.error ?? 'verification failed'}</>
      ) : (
        <>
          <LockIcon /> Verify signature
        </>
      )}
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-200"
    >
      {copied ? 'copied!' : 'copy'}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden
    />
  );
}

function BigCheck() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8.5L7 12L13 4.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3.5" y="7" width="9" height="6" rx="1.2" />
      <path d="M5.5 7V4.5a2.5 2.5 0 015 0V7" />
    </svg>
  );
}
