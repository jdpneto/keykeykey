/**
 * Credential (login) schema — stores website logins.
 */

import { z } from 'zod';
import { baseVaultItemFields } from './base.js';

const appIdentifierString = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/));

export const CredentialSchema = z
  .object({
    ...baseVaultItemFields,
    type: z.literal('credential'),
    url: z.string().url().optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    notes: z.string().optional(),
    totp: z.string().optional(),
    appIdentifiers: z.array(appIdentifierString).optional(),
    passwordHistory: z
      .array(
        z.object({
          password: z.string(),
          changedAt: z.string().datetime(),
        }),
      )
      .max(20)
      .default([]),
  })
  .passthrough();

export type Credential = z.infer<typeof CredentialSchema>;
