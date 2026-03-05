/**
 * Secure note schema — stores free-form encrypted text.
 */

import { z } from 'zod';
import { baseVaultItemFields } from './base.js';

export const SecureNoteSchema = z
  .object({
    ...baseVaultItemFields,
    type: z.literal('secure-note'),
    content: z.string(),
  })
  .strict();

export type SecureNote = z.infer<typeof SecureNoteSchema>;
