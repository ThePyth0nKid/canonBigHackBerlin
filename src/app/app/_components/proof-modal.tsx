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
        className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
      >
        view proof →
      </button>
      {open && <ProofModal fact={fact} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProofModal({ fact, onClose }: { fact: FactRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-wide text-zinc-500">
              FactEvent · {fact.status}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{fact.claim}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            ×
          </button>
        </div>

        <dl className="mt-6 space-y-3 text-sm">
          <Row label="Entity" value={fact.entity} mono />
          {fact.metricKey && (
            <Row
              label="Metric"
              value={`${fact.metricKey} = ${fact.metricValue ?? '?'}${fact.metricUnit ?? ''}`}
              mono
            />
          )}
          <Row label="Source" value={fact.sourceRef} mono small />
          {fact.sourceExcerpt && (
            <Row
              label="Excerpt"
              value={`"${fact.sourceExcerpt}"`}
              small
            />
          )}
          {fact.observedAt && (
            <Row label="Observed" value={fact.observedAt.toISOString()} mono small />
          )}
          <Row label="Signed at" value={fact.signedAt.toISOString()} mono small />
          <Row label="Signer pubkey" value={fact.signerPubkey} mono small wrap />
          <Row
            label="Parent hash"
            value={fact.parentHash ?? '— (genesis)'}
            mono
            small
            wrap
          />
          <Row label="Event hash" value={fact.eventHash} mono small wrap />
          {fact.notes && <Row label="Notes" value={fact.notes} small />}
        </dl>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wide text-zinc-500">
              COSE_Sign1 (hex)
            </span>
            <div className="flex items-center gap-3">
              <VerifyButton factId={fact.id} />
              <CopyButton value={fact.coseSign1Hex} />
            </div>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-zinc-700 dark:text-zinc-300">
            {fact.coseSign1Hex}
          </pre>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          Verified by <code className="font-mono">canon-verify</code> — a
          separate binary from the signer. Tamper any byte and the signature
          fails. The signer pubkey above is what an external agent pins.
        </p>
      </div>
    </div>
  );
}

interface VerifyResp {
  verified: boolean;
  eventHash?: string;
  kid?: string;
  error?: string;
  latencyMs?: number;
}

function VerifyButton({ factId }: { factId: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerifyResp | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      {result ? (
        result.verified ? (
          <span className="font-mono text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            ✓ verified · {result.latencyMs}ms
          </span>
        ) : (
          <span className="font-mono text-[11px] font-medium text-rose-600 dark:text-rose-400">
            ✗ {result.error ?? 'failed'}
          </span>
        )
      ) : null}
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
        className="text-xs font-medium text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-50"
      >
        {pending ? 'verifying…' : 'verify'}
      </button>
    </span>
  );
}

function Row({
  label,
  value,
  mono,
  small,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd
        className={[
          mono ? 'font-mono' : '',
          small ? 'text-xs' : 'text-sm',
          wrap ? 'break-all' : 'truncate',
          'text-zinc-900 dark:text-zinc-100',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
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
      className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
    >
      {copied ? 'copied!' : 'copy'}
    </button>
  );
}
