'use server';

import { auth } from '@/auth';
import { askCanon, type CanonAnswer } from '@/lib/canon/ask';

export async function askCanonAction(args: {
  question: string;
  workspace?: string;
}): Promise<CanonAnswer | { error: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: 'unauthorized' };
  return askCanon({
    userId,
    workspace: args.workspace ?? 'inazuma',
    question: args.question,
  });
}
