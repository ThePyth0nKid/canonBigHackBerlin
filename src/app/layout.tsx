import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Canon — One file. Every source. Every agent.",
  description:
    "Cryptographically signed, hash-chained context layer for AI agents. MCP-native, Ed25519, open source.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-50">
        <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-900 dark:bg-black/60">
          <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between px-6">
            <Link
              href="/"
              className="group inline-flex items-center font-mono text-[13px] font-semibold tracking-tight text-zinc-900 hover:text-zinc-600 dark:text-zinc-50 dark:hover:text-zinc-300"
            >
              canon
              <span className="mx-0.5 text-emerald-500 transition-colors group-hover:text-emerald-400">/</span>
              <span className="text-zinc-400 dark:text-zinc-500">v0.1</span>
            </Link>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-600">
              Big Berlin Hack 2026
            </span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
