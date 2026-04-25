import Link from "next/link";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-zinc-200 dark:border-zinc-900">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(circle_at_70%_40%,rgba(16,185,129,0.10),transparent_55%)]"
        />
        <div className="mx-auto grid w-full max-w-5xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white/60 px-3 py-1 text-[11px] font-medium text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Big Berlin Hack 2026 · Qontext Track
            </div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              One file.
              <br />
              Every source.
              <br />
              <span className="text-zinc-400 dark:text-zinc-500">Every agent.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              Canon is the cryptographically signed, hash-chained context layer
              for AI. Every fact is extracted from a real source, signed with
              Ed25519, and chained into an audit trail your agents can verify
              offline.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              {session ? (
                <Link
                  href="/app"
                  className="flex h-12 items-center justify-center rounded-full bg-zinc-950 px-6 text-sm font-medium text-white shadow-lg shadow-zinc-950/10 transition-all hover:bg-zinc-800 hover:shadow-xl dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Open workspace →
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="flex h-12 items-center justify-center rounded-full bg-zinc-950 px-6 text-sm font-medium text-white shadow-lg shadow-zinc-950/10 transition-all hover:bg-zinc-800 hover:shadow-xl dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                >
                  Start your workspace →
                </Link>
              )}
              <a
                href="https://github.com/ThePyth0nKid/canonBigHackBerlin"
                className="flex h-12 items-center justify-center gap-2 rounded-full border border-zinc-300 px-6 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="font-mono text-xs text-zinc-400">$</span>{" "}
                Read the spec
              </a>
            </div>
            <p className="mt-6 font-mono text-[11px] text-zinc-500">
              works with{" "}
              <span className="text-zinc-700 dark:text-zinc-300">slack</span> ·{" "}
              <span className="text-zinc-700 dark:text-zinc-300">gmail</span> ·{" "}
              <span className="text-zinc-700 dark:text-zinc-300">notion</span> ·{" "}
              <span className="text-zinc-700 dark:text-zinc-300">github</span> ·{" "}
              <span className="text-zinc-700 dark:text-zinc-300">pdf</span>
            </p>
          </div>

          {/* Right: a static "signed fact" card preview — show, don't tell */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                FactEvent · active
              </p>
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                f_8809f0c7…
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold">
              ACME Corp · 50 seats × €2,400/yr = €120,000 ARR
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Renewal 2026-05-15
            </p>
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-[10px] leading-relaxed dark:border-zinc-800 dark:bg-black">
              <div className="text-zinc-500">
                parent &nbsp;
                <span className="text-zinc-400">9c0aa2f5…b2b8</span>
              </div>
              <div className="text-emerald-600 dark:text-emerald-400">
                ↳ event &nbsp;&nbsp;0ec53cfb…421d
              </div>
              <div className="text-zinc-500">
                pubkey &nbsp;
                <span className="text-zinc-400">ed25519:Kf/SQkZv…</span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px]">
              <span className="font-mono text-zinc-500">
                COSE_Sign1 · 387 bytes
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                ✓ verified · 12ms
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pillar grid — differentiated cards with hairline dividers */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              glyph: "⌘",
              title: "MCP-native",
              sub: "5 tools · drop-in for Claude, Cursor, agents",
            },
            {
              glyph: "◉",
              title: "Ed25519",
              sub: "every fact signed at ingest · ~12ms verify",
            },
            {
              glyph: "↳",
              title: "Hash-chained",
              sub: "parentHash → eventHash · tamper-evident",
            },
            {
              glyph: "∅",
              title: "MIT licensed",
              sub: "open source · self-host · EU infrastructure",
            },
          ].map((p) => (
            <div key={p.title} className="bg-white p-6 dark:bg-zinc-950">
              <span className="font-mono text-2xl text-emerald-600 dark:text-emerald-400">
                {p.glyph}
              </span>
              <p className="mt-3 text-sm font-semibold">{p.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {p.sub}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* The 4-layer pipeline as a quick visual proof */}
      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <p className="mb-5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          The trust pipeline
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: "01",
              title: "Pioneer",
              sub: "deterministic span extraction (Fastino GLiNER-2)",
            },
            {
              n: "02",
              title: "Gemini",
              sub: "long-context audit (2M tokens, contradiction-flagging)",
            },
            {
              n: "03",
              title: "Aikido + scan",
              sub: "secret/PII refusal · repo-health monitoring",
            },
            {
              n: "04",
              title: "canon-signer",
              sub: "Ed25519 + COSE_Sign1, hash-chained, offline-verifiable",
            },
          ].map((step) => (
            <div
              key={step.n}
              className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className="font-mono text-[11px] tracking-wider text-emerald-600 dark:text-emerald-400">
                {step.n}
              </span>
              <p className="mt-1 text-sm font-semibold">{step.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
                {step.sub}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
