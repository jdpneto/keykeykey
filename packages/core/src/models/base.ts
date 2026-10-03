/**
 * Shared base fields for all vault items.
 */

import { z } from 'zod';

/** UUID v4 format regex. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO 8601 datetime format regex. */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Shared fields for all vault items. */
export const baseVaultItemFields = {
  id: z.string().regex(UUID_REGEX, 'Must be a valid UUID v4'),
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().regex(ISO_DATE_REGEX, 'Must be an ISO 8601 datetime'),
  updatedAt: z.string().regex(ISO_DATE_REGEX, 'Must be an ISO 8601 datetime'),
  favorite: z.boolean().default(false),
} as const;

/**
 * `datetime` string as accepted by zod 3's `z.string().datetime()` defaults:
 * a leap-year-aware calendar date, `T`, `HH:MM` with *optional* seconds and
 * optional fractional seconds of any precision, and a mandatory `Z` (no
 * offsets, no local time). zod 4's `z.iso.datetime()` makes seconds mandatory,
 * which would reject previously-valid stored values (and therefore make the
 * whole item fail to decrypt), so the zod 3 grammar is pinned here.
 */
const ZOD3_DATETIME_REGEX = new RegExp(
  '^((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|' +
    '\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))' +
    'T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z)$',
);

/** UTC ISO 8601 datetime string with zod 3 `.datetime()` acceptance rules. */
export const datetimeString = () => z.string().regex(ZOD3_DATETIME_REGEX, 'Invalid ISO datetime');

/**
 * URL string with zod 3 `.url()` semantics: valid iff the WHATWG `URL`
 * constructor accepts it, and the value is never rewritten. zod 4's `.url()`
 * trims the value and strips tabs/newlines from it on success, which would
 * silently mutate stored credential URLs.
 */
export const urlString = () =>
  z.string().check((ctx) => {
    try {
      new URL(ctx.value);
    } catch {
      ctx.issues.push({
        code: 'invalid_format',
        format: 'url',
        input: ctx.value,
        message: 'Invalid URL',
      });
    }
  });

/**
 * Integer number with zod 3 `.int()` semantics (`Number.isInteger`). zod 4's
 * `.int()` additionally rejects values outside the safe-integer range, which
 * zod 3 accepted.
 */
export const integerNumber = () =>
  z.number().check((ctx) => {
    if (!Number.isInteger(ctx.value)) {
      ctx.issues.push({
        code: 'invalid_type',
        expected: 'int',
        input: ctx.value,
        message: 'Invalid input: expected int, received number',
      });
    }
  });

/** Reusable UUID regex for external use. */
export const UUID_V4_REGEX = UUID_REGEX;

/** Reusable ISO date regex for external use. */
export const ISO_8601_REGEX = ISO_DATE_REGEX;
