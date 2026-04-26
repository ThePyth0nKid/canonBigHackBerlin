/**
 * Magic-link landing route. Verifies the URL token, sets the persona
 * cookie (httpOnly, signed, 30min TTL), then redirects to /decide.
 *
 * Magic-link emails now point recipients here (not directly at /decide?token=)
 * so the persona token never lingers in browser history or referrer headers.
 * Once the cookie is set the URL is clean — subsequent server actions
 * read the cookie via readPersonaContext() to enforce RBAC.
 */

import { NextResponse } from 'next/server';
import { verifyMagicToken } from '@/lib/canon/decide-mail';
import { setPersonaCookie } from '@/lib/canon/persona-cookie';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const verifyResult = verifyMagicToken({
    thread: url.searchParams.get('thread'),
    as: url.searchParams.get('as'),
    exp: url.searchParams.get('exp'),
    sig: url.searchParams.get('sig'),
  });

  if (!verifyResult.ok) {
    // Bad token → bounce to /decide with an error flag the page can render.
    const reason = verifyResult.reason;
    return NextResponse.redirect(new URL(`/decide?token_error=${reason}`, url.origin));
  }

  await setPersonaCookie({
    threadId: verifyResult.threadId,
    as: verifyResult.as,
  });

  // Clean URL after persona is set — token never appears in /decide history.
  return NextResponse.redirect(new URL('/decide', url.origin));
}
