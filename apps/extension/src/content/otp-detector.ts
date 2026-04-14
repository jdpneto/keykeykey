/**
 * Detect TOTP / 2FA one-time-code input fields on the page.
 *
 * Two strategies, in order:
 * 1. `autocomplete="one-time-code"` (canonical, no false positives).
 * 2. Heuristic: numeric inputmode + short maxlength (6–8) + name/id matching
 *    common 2FA patterns. Conservative on purpose; we'd rather miss an OTP
 *    field than offer an autofill on a CVV or phone-number field.
 */

const OTP_NAME_PATTERN =
  /(^|[_\-\b])(otp|totp|2fa|two[_-]?factor|mfa|verification|verify|auth_?code|one[_-]?time)([_\-\b]|$)/i;

export function detectOtpFields(root: ParentNode = document): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  const out: HTMLInputElement[] = [];

  for (const input of root.querySelectorAll<HTMLInputElement>('input')) {
    if (seen.has(input)) continue;
    if (!isOtpField(input)) continue;
    seen.add(input);
    out.push(input);
  }

  return out;
}

function isOtpField(input: HTMLInputElement): boolean {
  // Never match password fields — passwords have their own autofill flow.
  const type = (input.type || 'text').toLowerCase();
  if (type === 'password') return false;

  // Strategy 1: autocomplete="one-time-code" (HTML spec)
  const ac = (input.getAttribute('autocomplete') ?? '').toLowerCase();
  const acTokens = ac.split(/\s+/);
  if (acTokens.includes('one-time-code')) return true;

  // Strategy 2: heuristics for sites that don't use the canonical attribute.
  // Require the combination of numeric input + a short max length + a
  // suggestive name/id, so we don't match CVVs (3 chars), phone numbers
  // (10+), credit cards (16), etc.
  const inputmode = (input.getAttribute('inputmode') ?? '').toLowerCase();
  const isNumeric = inputmode === 'numeric' || inputmode === 'decimal' || type === 'tel';
  if (!isNumeric) return false;

  const maxLengthAttr = input.getAttribute('maxlength');
  const maxLength = maxLengthAttr ? Number.parseInt(maxLengthAttr, 10) : NaN;
  // RFC 4226 allows 6, 7, or 8 digit codes; also accept a single-digit slot
  // for split-input TOTP fields (deferred — handled in a later pass).
  if (!Number.isFinite(maxLength) || maxLength < 6 || maxLength > 8) return false;

  const name = input.name || '';
  const id = input.id || '';
  return OTP_NAME_PATTERN.test(name) || OTP_NAME_PATTERN.test(id);
}
