/**
 * Credential (login) schema — stores website logins.
 */

import { z } from 'zod';
import { baseVaultItemFields } from './base.js';

export const CredentialSchema = z
  .object({
    ...baseVaultItemFields,
    type: z.literal('credential'),
    url: z.string().url().optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    notes: z.string().optional(),
    totp: z.string().optional(),
  })
  .strict();

export type Credential = z.infer<typeof CredentialSchema>;
