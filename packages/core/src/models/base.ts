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

/** Reusable UUID regex for external use. */
export const UUID_V4_REGEX = UUID_REGEX;

/** Reusable ISO date regex for external use. */
export const ISO_8601_REGEX = ISO_DATE_REGEX;
