/**
 * Vault item schemas — discriminated union of all item types.
 *
 * Every vault item shares common fields (id, name, tags, timestamps, favorite).
 * The `type` field discriminates between Credential, Card, and SecureNote.
 */

import { z } from 'zod';
import { UUID_V4_REGEX, ISO_8601_REGEX } from './base.js';
import { CredentialSchema } from './credential.js';
import { CardSchema } from './card.js';
import { SecureNoteSchema } from './secure-note.js';

/**
 * Discriminated union of all vault item types.
 * Use `type` field to distinguish: "credential" | "card" | "secure-note"
 */
export const VaultItemSchema = z.discriminatedUnion('type', [
  CredentialSchema,
  CardSchema,
  SecureNoteSchema,
]);

export type VaultItem = z.infer<typeof VaultItemSchema>;

/**
 * Encrypted vault item — the on-disk format.
 *
 * Only `id`, `type`, and timestamps are stored in cleartext.
 * The actual item data is encrypted as a blob.
 */
export const EncryptedVaultItemSchema = z
  .object({
    id: z.string().regex(UUID_V4_REGEX, 'Must be a valid UUID v4'),
    type: z.enum(['credential', 'card', 'secure-note']),
    encryptedData: z.instanceof(Uint8Array),
    createdAt: z.string().regex(ISO_8601_REGEX, 'Must be an ISO 8601 datetime'),
    updatedAt: z.string().regex(ISO_8601_REGEX, 'Must be an ISO 8601 datetime'),
  })
  .passthrough();

export type EncryptedVaultItem = z.infer<typeof EncryptedVaultItemSchema>;
