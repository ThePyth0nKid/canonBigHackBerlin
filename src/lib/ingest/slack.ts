/**
 * Slack source adapter — reads `#sales` history, chunks per message,
 * hands off to Pioneer for entity+metric extraction.
 *
 * Channel: C0B058UN0PK in workspace `test-canon`.
 * Auth: SLACK_USER_TOKEN (xoxp-...) — user-level token reads channel history.
 */

import type { FactDraft } from '../canon/types';
import { extractFactsFromChunks, type Chunk } from '../canon/pioneer';

const SLACK_API = 'https://slack.com/api';
const DEFAULT_CHANNEL = process.env.SLACK_DEMO_CHANNEL ?? 'C0B058UN0PK';

interface SlackMessage {
  type: string;
  subtype?: string;
  text: string;
  ts: string;
  user?: string;
  bot_id?: string;
}

interface ConversationsHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

export interface SlackIngestResult {
  channel: string;
  messageCount: number;
  drafts: FactDraft[];
}

export async function ingestSlackChannel(opts?: {
  channel?: string;
  limit?: number;
}): Promise<SlackIngestResult> {
  const channel = opts?.channel ?? DEFAULT_CHANNEL;
  const messages = await fetchHistory(channel, opts?.limit ?? 100);
  const chunks = messagesToChunks(channel, messages);
  const drafts = await extractFactsFromChunks(chunks);
  return { channel, messageCount: messages.length, drafts };
}

async function fetchHistory(channel: string, limit: number): Promise<SlackMessage[]> {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) throw new Error('SLACK_USER_TOKEN not set');

  const url = `${SLACK_API}/conversations.history?channel=${encodeURIComponent(channel)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
  const data = (await res.json()) as ConversationsHistoryResponse;
  if (!data.ok) throw new Error(`Slack API error: ${data.error ?? 'unknown'}`);
  const msgs = (data.messages ?? []).filter(isUserMessage);
  return msgs.sort((a, b) => Number(a.ts) - Number(b.ts));
}

function isUserMessage(m: SlackMessage): boolean {
  if (m.type !== 'message') return false;
  if (m.subtype && m.subtype !== 'thread_broadcast') return false;
  if (!m.text || m.text.trim().length === 0) return false;
  return true;
}

function messagesToChunks(channel: string, messages: SlackMessage[]): Chunk[] {
  return messages.map((m) => {
    const text = cleanSlackText(m.text);
    // Author suffix lets /decide page identify the human behind the fact
    // for the Stage-1 ask-source-authors path. Empty when bot/system msg.
    const authorSuffix = m.user ? `#u=${m.user}` : '';
    return {
      text,
      sourceRef: `slack:${channel}:${m.ts}${authorSuffix}`,
      observedAt: tsToIso(m.ts),
      sourceExcerpt: text.slice(0, 240),
      // Internal team channel — facts without an explicit customer name
      // belong to Inazuma itself (post-pivot single-workspace world).
      defaultEntity: 'inazuma',
    };
  });
}

/** Strip Slack mark-up that's noise for entity extraction. */
function cleanSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => (name ? `@${name}` : ''))
    .replace(/<#[A-Z0-9]+(?:\|([^>]+))?>/g, (_, name) => (name ? `#${name}` : ''))
    .replace(/<(https?:\/\/[^|>]+)(?:\|[^>]+)?>/g, '$1')
    .replace(/[ ]/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function tsToIso(ts: string): string {
  const seconds = Number(ts.split('.')[0]);
  if (!Number.isFinite(seconds)) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}
