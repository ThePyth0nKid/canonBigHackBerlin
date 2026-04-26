/**
 * Risk tier per metricKey. Drives the four-eyes principle: 'high' picks
 * are written as resolution-pending (no supersedure) and require a
 * second admin to co-sign before they take effect on the chain.
 *
 * The heuristic intentionally errs on the side of "high" for anything
 * money-shaped, contract-shaped, or churn-shaped — the cost of
 * blocking a low-risk metric is a second click, the cost of waving
 * through a wrong ARR is a board-deck error.
 */
export type RiskTier = 'low' | 'medium' | 'high';

const HIGH_RE =
  /(arr|mrr|acv|tcv|contract|revenue|renewal|churn|deal[_-]?size|pipeline|forecast|gmv|ltv|cac|burn|runway|valuation|equity|cap[_-]?table|seats?\b|price)/i;

const MEDIUM_RE =
  /(tier|status|stage|owner|account[_-]?manager|csm|industry|segment|region|country|headcount|employees?|contact|email|phone)/i;

export function riskTier(metricKey: string | null | undefined): RiskTier {
  if (!metricKey) return 'low';
  const k = metricKey.toLowerCase();
  if (HIGH_RE.test(k)) return 'high';
  if (MEDIUM_RE.test(k)) return 'medium';
  return 'low';
}

export function tierLabel(tier: RiskTier): string {
  return tier === 'high'
    ? '4-eyes required'
    : tier === 'medium'
      ? 'standard'
      : 'low risk';
}

export function tierExplain(tier: RiskTier): string {
  return tier === 'high'
    ? 'High-risk metric. The pick is written as resolution-pending; supersedure only applies once a second admin co-signs.'
    : tier === 'medium'
      ? 'Standard metric. Single admin signature creates the resolution.'
      : 'Low-risk metric. Single signature creates the resolution.';
}
