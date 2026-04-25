/**
 * Pre-sign scan engine — Layer 3 of the Trust Pipeline.
 *
 * Local pattern engine: high-precision regex for common secret families
 * (Gitleaks/TruffleHog-style) and PII shapes. If a draft's claim or excerpt
 * trips a pattern, the pipeline emits a RedactionEvent (signed, claim
 * replaced with "<redacted>") instead of a plain FactEvent.
 *
 * Companion: src/lib/canon/aikido.ts fetches the live repo-health banner so
 * the UI can show "Source: canonBigHackBerlin · Aikido-monitored · 0 issues".
 */

export type ScanCategory = 'secret' | 'pii';

export interface ScanRule {
  id: string;
  category: ScanCategory;
  /** Pattern matching family — used as the redactionReason tag. */
  pattern: RegExp;
  /** Minimum match length to count, prevents trivial false-positives. */
  minLen?: number;
}

const SECRET_RULES: ScanRule[] = [
  {
    id: 'aws_access_key',
    category: 'secret',
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
  },
  {
    id: 'aws_secret_key',
    category: 'secret',
    pattern: /\b(?:aws_secret_access_key|aws_secret)[\s:=]+["']?([A-Za-z0-9/+=]{40})["']?/gi,
  },
  {
    id: 'github_token',
    category: 'secret',
    pattern: /\bgh[opsu]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: 'github_pat',
    category: 'secret',
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g,
  },
  {
    id: 'anthropic_key',
    category: 'secret',
    pattern: /\bsk-ant-(?:api03|admin01|priv01)-[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    id: 'openai_key',
    category: 'secret',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    id: 'slack_token',
    category: 'secret',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'stripe_key',
    category: 'secret',
    pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: 'pioneer_key',
    category: 'secret',
    pattern: /\bpio_sk_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'aikido_secret',
    category: 'secret',
    pattern: /\bAIK_(?:CLIENT|SECRET|CI)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: 'private_key_pem',
    category: 'secret',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    category: 'secret',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'postgres_url',
    category: 'secret',
    pattern: /postgres(?:ql)?:\/\/[^\s'"<>]+:[^\s'"<>@]+@[^\s'"<>]+/g,
  },
];

const PII_RULES: ScanRule[] = [
  {
    id: 'iban',
    category: 'pii',
    // IBAN: 2 country letters + 2 check digits + up to 30 alphanumerics.
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    minLen: 15,
  },
  {
    id: 'credit_card',
    category: 'pii',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
  },
  {
    id: 'email_address',
    category: 'pii',
    // Allow-list demo domains (the cast). Anything else trips PII.
    // Implemented in scanText as a post-filter.
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    id: 'phone_intl',
    category: 'pii',
    pattern: /(?:^|\s)\+\d{1,3}[ \-.]?(?:\(?\d{1,4}\)?[ \-.]?){2,4}\d{2,4}\b/g,
    minLen: 10,
  },
];

const ALLOWED_EMAIL_DOMAINS = new Set([
  'northwind.co',
  'acme.com',
  'techco.io',
  'globex.com',
  'initech.com',
  'umbrella.co',
  'soylent.com',
  'ultranova.io',
]);

export interface ScanFinding {
  ruleId: string;
  category: ScanCategory;
  /** Verbatim match (always cropped to 64 chars in output). */
  match: string;
}

export interface ScanResult {
  cleared: boolean;
  /** Set when !cleared — joined as "category:rule_id". */
  redactionReason?: string;
  findings: ScanFinding[];
}

const RULES: ScanRule[] = [...SECRET_RULES, ...PII_RULES];

/**
 * Scan a piece of text for secret/PII patterns. Returns ALL findings
 * but the pipeline only needs to know `cleared` + a redactionReason tag.
 */
export function scanText(text: string): ScanResult {
  const findings: ScanFinding[] = [];

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      const match = m[0];
      if (rule.minLen && match.replace(/[\s-]/g, '').length < rule.minLen) continue;
      if (rule.id === 'email_address' && isAllowedEmail(match)) continue;
      if (rule.id === 'credit_card' && !luhnValid(match)) continue;
      findings.push({
        ruleId: rule.id,
        category: rule.category,
        match: match.length > 64 ? match.slice(0, 61) + '…' : match,
      });
      // Avoid infinite loops on zero-width matches.
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
    }
  }

  if (findings.length === 0) return { cleared: true, findings: [] };
  const top = findings[0];
  return {
    cleared: false,
    redactionReason: `${top.category}:${top.ruleId}`,
    findings,
  };
}

/**
 * Convenience: scan a draft's claim + excerpt together. Returns the same
 * shape — pipeline branches on `cleared`.
 */
export function scanDraft(claim: string, excerpt: string): ScanResult {
  const both = `${claim}\n${excerpt}`;
  return scanText(both);
}

function isAllowedEmail(addr: string): boolean {
  const at = addr.indexOf('@');
  if (at < 0) return false;
  const domain = addr.slice(at + 1).toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.has(domain);
}

/** Luhn check — drops false-positive numeric runs from the credit_card rule. */
function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
