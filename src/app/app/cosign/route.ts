/**
 * 4-eyes co-sign magic-link landing route. Verifies the URL token,
 * sets the canon_cosign cookie (httpOnly, signed, 30min TTL), then
 * redirects to /app with the matching pending row highlighted.
 *
 * Mirrors /decide/enter route. Tokens never linger in browser
 * history or referrer headers — once the cookie is set, the URL is
 * clean and the rest of the cosign happens via cookie-authorised
 * server action.
 */

import { NextResponse } from 'next/server';
import { verifyCosignToken } from '@/lib/canon/cosign-mail';
import { setCosignCookie } from '@/lib/canon/cosign-cookie';
import { isAdminEmail } from '@/lib/canon/admin';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const verifyResult = verifyCosignToken({
    res: url.searchParams.get('res'),
    as: url.searchParams.get('as'),
    exp: url.searchParams.get('exp'),
    sig: url.searchParams.get('sig'),
  });

  if (!verifyResult.ok) {
    return NextResponse.redirect(
      new URL(`/app?cosign_error=${verifyResult.reason}`, url.origin),
    );
  }

  // Defence-in-depth: even with a valid signature, the asEmail must
  // resolve to a current admin. Limits magic-link reuse if the env
  // changes after a token was issued.
  if (!isAdminEmail(verifyResult.asEmail)) {
    return NextResponse.redirect(
      new URL('/app?cosign_error=not_admin', url.origin),
    );
  }

  await setCosignCookie({
    resolutionFactId: verifyResult.resolutionFactId,
    asEmail: verifyResult.asEmail,
  });

  // Land on /app with a hash anchor pointing at the pending row id.
  // The panel uses the cookie (not the hash) for highlight + scroll;
  // the hash is just a visual cue that mirrors what the panel renders.
  return NextResponse.redirect(
    new URL(`/app#pending-${verifyResult.resolutionFactId}`, url.origin),
  );
}
