import Link from "next/link";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20">
      <div className="w-full max-w-3xl">
        <div className="mb-4 inline-block rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          Big Berlin Hack 2026 · Qontext Track
        </div>

        <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
          One file.
          <br />
          Every source.
          <br />
          Every agent.
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Canon is the cryptographically signed, hash-chained context layer for
          AI. Every fact is extracted from a real source, signed with Ed25519,
          and chained into an audit trail your agents can verify offline.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {session ? (
            <Link
              href="/app"
              className="flex h-12 items-center justify-center rounded-full bg-zinc-950 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Open workspace →
            </Link>
          ) : (
            <Link
              href="/login"
              className="flex h-12 items-center justify-center rounded-full bg-zinc-950 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Start your workspace
            </Link>
          )}
          <a
            href="https://github.com/ThePyth0nKid/empheral"
            className="flex h-12 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
          >
            Read the spec
          </a>
        </div>

        <dl className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["MCP-native", "6 tools"],
            ["Ed25519", "signed"],
            ["Hash-chained", "auditable"],
            ["MIT", "open source"],
          ].map(([label, sub]) => (
            <div
              key={label}
              className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <dt className="text-xs font-medium text-zinc-500">{sub}</dt>
              <dd className="mt-0.5 text-sm font-semibold">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
