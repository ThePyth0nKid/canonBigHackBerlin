/**
 * Stage-2 escalation routing.
 *
 * Maps a metricKey pattern to the authority role that signs canonical
 * truth when source-authors can't agree at Stage 1. Hardcoded for V1 —
 * dynamic per-workspace policy is V2.
 *
 * Roles resolve to a User.email at runtime; the matching User row must
 * exist before /decide can route to that role. The seed-decide script
 * ensures alice/bob/lina/greg/nelson rows are present.
 */

export type EscalationRole = 'deal_owner' | 'revops_lead' | 'cfo';

interface PolicyRule {
  /** Substring match against metricKey (case-insensitive). First match wins. */
  pattern: string;
  role: EscalationRole;
}

const RULES: PolicyRule[] = [
  { pattern: 'per_seat_price', role: 'cfo' },
  { pattern: 'mrr', role: 'cfo' },
  { pattern: 'arr', role: 'cfo' },
  { pattern: 'forecast', role: 'cfo' },
  { pattern: 'pipeline', role: 'revops_lead' },
  { pattern: 'acv', role: 'revops_lead' },
  { pattern: 'price', role: 'revops_lead' },
  { pattern: 'amount', role: 'revops_lead' },
];

const DEFAULT_ROLE: EscalationRole = 'deal_owner';

const ROLE_TO_EMAIL: Record<EscalationRole, string> = {
  deal_owner: 'lina@inazuma.example',
  revops_lead: 'lina@inazuma.example',
  cfo: 'nelson@ultranova.io',
};

export function routeMetricToRole(metricKey: string | null | undefined): EscalationRole {
  if (!metricKey) return DEFAULT_ROLE;
  const lower = metricKey.toLowerCase();
  for (const rule of RULES) {
    if (lower.includes(rule.pattern)) return rule.role;
  }
  return DEFAULT_ROLE;
}

export function emailForRole(role: EscalationRole): string {
  return ROLE_TO_EMAIL[role];
}

/**
 * Parse author identifier out of a sourceRef suffix.
 *
 * Slack:  `slack:CHANNEL:TS#u=USERID`     → returns { kind: 'slack', id: 'USERID' }
 * Gmail:  `gmail:MID#pN#from=email@x.com` → returns { kind: 'gmail', id: 'email@x.com' }
 * Other / no suffix:                      → returns null
 */
export function parseSourceAuthor(
  sourceRef: string,
): { kind: 'slack' | 'gmail'; id: string } | null {
  const slackMatch = sourceRef.match(/^slack:[^#]+(?:#u=([A-Za-z0-9_]+))/);
  if (slackMatch?.[1]) return { kind: 'slack', id: slackMatch[1] };
  const gmailMatch = sourceRef.match(/^gmail:[^#]+(?:#p\d+)?(?:#from=([^#\s]+))/);
  if (gmailMatch?.[1]) return { kind: 'gmail', id: gmailMatch[1].toLowerCase() };
  return null;
}
