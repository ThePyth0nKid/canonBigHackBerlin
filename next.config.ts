import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse / pdfjs-dist ship a worker file that Turbopack/webpack mangle
  // when bundled — keep them as external Node modules so the worker resolves
  // at runtime via the regular module loader.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
