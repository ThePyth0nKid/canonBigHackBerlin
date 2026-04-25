'use server';

import { auth } from '@/auth';
import { askCanon, type CanonAnswer } from '@/lib/canon/ask';

export async function askCanonAction(args: {
  question: string;
  workspace?: string;
}): Promise<CanonAnswer | { error: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    console.warn('[askCanonAction] unauthorized — no session.user.id');
    return { error: 'unauthorized — please sign in again' };
  }
  try {
    const r = await askCanon({
      userId,
      workspace: args.workspace ?? 'inazuma',
      question: args.question,
    });
    if ('error' in r) {
      console.warn(
        `[askCanonAction] returned error to client: "${r.error}" · q="${(args.question || '').slice(0, 60)}"`,
      );
    }
    return r;
  } catch (e) {
    // Catch unhandled rejections from askCanon so the server action ALWAYS
    // returns a serialisable shape and the UI never sees an unhandled
    // server-action throw (which leaves the client spinner armed).
    console.error('[askCanonAction] unhandled', e);
    return {
      error: `Server error: ${(e as Error).message ?? 'unknown'} — check Railway logs`,
    };
  }
}
