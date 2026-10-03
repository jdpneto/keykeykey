/**
 * Payment card schema — stores credit/debit card details.
 */

import { z } from 'zod';
import { baseVaultItemFields, integerNumber } from './base.js';

export const CardSchema = z.looseObject({
  ...baseVaultItemFields,
  type: z.literal('card'),
  cardholderName: z.string().min(1),
  number: z.string().min(1),
  expirationMonth: integerNumber().min(1).max(12),
  expirationYear: integerNumber().min(0),
  cvv: z.string().min(3).max(4),
  pin: z.string().optional(),
  notes: z.string().optional(),
});

export type Card = z.infer<typeof CardSchema>;
