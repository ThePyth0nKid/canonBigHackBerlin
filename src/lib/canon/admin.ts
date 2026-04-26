import { auth } from '@/auth';

/**
 * Admin gate for sensitive ops (so far: reverseResolution, coSignResolution).
 *
 * Production: set CANON_ADMIN_EMAILS to a comma-separated list of
 * authenticated user emails that should be able to reverse signed
 * resolutions. Anyone else with a session is read-only on this surface.
 *
 * Dev / unset: any signed-in user is treated as admin so the demo
 * doesn't need extra wiring.
 */
export function adminEmails(): string[] {
  const raw = process.env.CANON_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmails();
  if (list.length === 0) return true;
  return list.includes(email.toLowerCase());
}

export async function requireAdmin(): Promise<
  { ok: true; userId: string; email: string } | { ok: false }
> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const email = session?.user?.email ?? null;
  if (!userId) return { ok: false };
  if (!isAdminEmail(email)) return { ok: false };
  return { ok: true, userId, email: email ?? '' };
}
