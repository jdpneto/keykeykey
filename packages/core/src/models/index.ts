/**
 * Data models for KeyKeyKey vault items.
 *
 * All schemas are built with Zod for runtime validation.
 *
 * @module models
 */

export { CredentialSchema } from './credential.js';
export type { Credential } from './credential.js';

export { CardSchema } from './card.js';
export type { Card } from './card.js';

export { SecureNoteSchema } from './secure-note.js';
export type { SecureNote } from './secure-note.js';

export { baseVaultItemFields } from './base.js';

export { VaultItemSchema, EncryptedVaultItemSchema } from './vault-item.js';
export type { VaultItem, EncryptedVaultItem } from './vault-item.js';
