/**
 * Payment card schema — stores credit/debit card details.
 */

import { z } from 'zod';
import { baseVaultItemFields } from './base.js';

export const CardSchema = z
  .object({
    ...baseVaultItemFields,
    type: z.literal('card'),
    cardholderName: z.string().min(1),
    number: z.string().min(1),
    expirationMonth: z.number().int().min(1).max(12),
    expirationYear: z.number().int().min(2000).max(9999),
    cvv: z.string().min(3).max(4),
    pin: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export type Card = z.infer<typeof CardSchema>;
