import os from 'node:os';
import type { SecretFinding } from './types.js';

/**
 * Replaces the local OS home directory prefix with `~` so usernames never leak into UI screenshots or exports.
 */
export function sanitizeDisplayPath(filePath: string): string {
  if (!filePath) return filePath;
  const home = os.homedir();
  if (!home) return filePath;
  const normHome = home.replace(/\\/g, '/').replace(/\/+$/, '');
  const normPath = filePath.replace(/\\/g, '/');
  if (normPath.toLowerCase().startsWith(normHome.toLowerCase())) {
    return `~${normPath.slice(normHome.length)}`;
  }
  return filePath;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const KNOWN_SECRET_PATTERNS: SecretPattern[] = [
  { name: 'OpenAI API Key', regex: /\bsk-(?:proj-|live-|demo-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic API Key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Google / Gemini API Key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'GitHub Personal Access Token', regex: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{24,}\b/ },
  { name: 'GitHub Fine-Grained PAT', regex: /\bgithub_pat_[A-Za-z0-9_]{24,}\b/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack Token', regex: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
  { name: 'Stripe Secret Key', regex: /\bsk_(?:live|test)_[0-9a-zA-Z]{20,}\b/ },
  { name: 'JWT / Bearer Token', regex: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: 'Database Connection Password', regex: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:[^@\s/]{4,}@/i },
];

const SENSITIVE_KEY_NAME_RE =
  /(?:api[_-]?key|token|secret|password|passwd|pwd|private[_-]?key|auth|credential|dsn|connection[_-]?string)/i;

const PLACEHOLDER_VALUE_RE =
  /^(?:\$\{[^}]+\}|\$[A-Z0-9_]+|<[^>]+>|YOUR_[A-Z0-9_]+|REPLACE_ME|changeme|example|placeholder|xxx+|todo|\*+)$/i;

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '••••••••';
  }
  const prefix = value.slice(0, 4);
  const suffix = value.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_VALUE_RE.test(trimmed)) return true;
  if (/^\$\{env:[^}]+\}$/i.test(trimmed)) return true;
  return false;
}

export function detectSecretInValue(
  value: string,
  keyHint?: string,
): { matched: boolean; patternName: string } {
  const trimmed = value.trim();
  if (!trimmed || isPlaceholderValue(trimmed)) {
    return { matched: false, patternName: '' };
  }

  for (const pattern of KNOWN_SECRET_PATTERNS) {
    if (pattern.regex.test(trimmed)) {
      return { matched: true, patternName: pattern.name };
    }
  }

  // Flag literal non-placeholder values assigned to sensitive env keys
  if (keyHint && SENSITIVE_KEY_NAME_RE.test(keyHint) && trimmed.length >= 10) {
    // Ignore obvious booleans, URLs without credentials, and local paths
    if (
      /^(true|false|yes|no|\d+)$/i.test(trimmed) ||
      /^[a-zA-Z]:\\/.test(trimmed) ||
      trimmed.startsWith('/') ||
      (/^https?:\/\/[^@]+$/.test(trimmed) && !trimmed.includes('key=') && !trimmed.includes('token='))
    ) {
      return { matched: false, patternName: '' };
    }
    return { matched: true, patternName: `Sensitive Env (${keyHint})` };
  }

  return { matched: false, patternName: '' };
}

export function redactMcpEnvironment(
  env: Record<string, unknown> | undefined,
): { redactedEnv: Record<string, string>; findings: SecretFinding[] } {
  const redactedEnv: Record<string, string> = {};
  const findings: SecretFinding[] = [];

  if (!env || typeof env !== 'object') {
    return { redactedEnv, findings };
  }

  for (const [key, rawVal] of Object.entries(env)) {
    const val = typeof rawVal === 'string' ? rawVal : String(rawVal ?? '');
    const check = detectSecretInValue(val, key);
    if (check.matched) {
      const masked = maskSecret(val);
      redactedEnv[key] = `[REDACTED:${masked}]`;
      findings.push({
        fieldPath: `env.${key}`,
        patternName: check.patternName,
        maskedPreview: masked,
      });
    } else {
      redactedEnv[key] = val;
    }
  }

  return { redactedEnv, findings };
}

export function redactMcpArgs(args: string[]): {
  redactedArgs: string[];
  findings: SecretFinding[];
} {
  const findings: SecretFinding[] = [];
  const redactedArgs = args.map((arg, index) => {
    const check = detectSecretInValue(arg);
    if (check.matched) {
      const masked = maskSecret(arg);
      findings.push({
        fieldPath: `args[${index}]`,
        patternName: check.patternName,
        maskedPreview: masked,
      });
      return `[REDACTED:${masked}]`;
    }
    return arg;
  });

  return { redactedArgs, findings };
}
