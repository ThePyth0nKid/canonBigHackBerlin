import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse / pdfjs-dist ship a worker file that Turbopack/webpack mangle
  // when bundled — keep them as external Node modules so the worker resolves
  // at runtime via the regular module loader.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // We don't ship any <Image> components — disable runtime image optimization
  // so the LGPL-transitive `sharp` library is never invoked at runtime. The
  // optional package is still installed by Next.js but unused; see NOTICE
  // for the compliance statement.
  images: { unoptimized: true },
  // The /app TrustGateBanner reads .semgrep/canon-trust-gate.yml at render
  // time so the UI is data-bound to the actual repo artifact. The path is
  // constructed dynamically (process.cwd() + path.join), so the file
  // tracer can't auto-detect it — declare it explicitly so it survives
  // the build and standalone bundling.
  outputFileTracingIncludes: {
    '/app': ['./.semgrep/canon-trust-gate.yml'],
  },
};

export default nextConfig;
