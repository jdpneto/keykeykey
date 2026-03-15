/**
 * PIN format validation for quick-unlock.
 *
 * Rules:
 * - Must be 4–8 numeric digits
 * - No all-same digits (e.g., 1111, 0000)
 * - No fully sequential ascending or descending (e.g., 1234, 4321)
 */

export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!/^\d{4,8}$/.test(pin)) {
    return { valid: false, error: 'PIN must be 4–8 digits' };
  }

  // All-same digits
  if (new Set(pin).size === 1) {
    return { valid: false, error: 'PIN must not be all repeated digits' };
  }

  // Sequential check: every consecutive pair differs by exactly +1 or -1
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i++) {
    const diff = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (diff !== 1) ascending = false;
    if (diff !== -1) descending = false;
  }
  if (ascending || descending) {
    return { valid: false, error: 'PIN must not be sequential digits' };
  }

  return { valid: true };
}
