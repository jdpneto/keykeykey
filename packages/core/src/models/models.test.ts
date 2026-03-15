import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  CredentialSchema,
  CardSchema,
  SecureNoteSchema,
  VaultItemSchema,
  EncryptedVaultItemSchema,
} from './index.js';

const now = new Date().toISOString();
const validId = uuidv4();

const validBase = {
  id: validId,
  name: 'Test Item',
  tags: ['tag1', 'tag2'],
  createdAt: now,
  updatedAt: now,
  favorite: false,
};

describe('CredentialSchema', () => {
  it('should accept a valid credential', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      url: 'https://example.com',
      username: 'user@example.com',
      password: 'super-secret-123',
      notes: 'My login',
      totp: 'JBSWY3DPEHPK3PXP',
    };

    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(true);
  });

  it('should accept credential without optional fields', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      username: 'user',
      password: 'pass',
    };

    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(true);
  });

  it('should reject credential with empty username', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      username: '',
      password: 'pass',
    };

    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(false);
  });

  it('should reject credential with empty password', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      username: 'user',
      password: '',
    };

    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(false);
  });

  it('should reject credential with invalid URL', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      url: 'not-a-url',
      username: 'user',
      password: 'pass',
    };

    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(false);
  });

  it('should accept and preserve unknown fields (passthrough)', () => {
    const credential = {
      ...validBase,
      type: 'credential' as const,
      username: 'user',
      password: 'pass',
      unknownField: 'should be preserved',
    };

    const result = CredentialSchema.safeParse(credential);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBe('should be preserved');
    }
  });
});

describe('CardSchema', () => {
  it('should accept a valid card', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'John Doe',
      number: '4111111111111111',
      expirationMonth: 12,
      expirationYear: 2027,
      cvv: '123',
      pin: '1234',
      notes: 'Personal card',
    };

    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('should accept card without optional fields', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane Doe',
      number: '5500000000000004',
      expirationMonth: 1,
      expirationYear: 2025,
      cvv: '456',
    };

    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('should reject card with invalid month', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane',
      number: '4111111111111111',
      expirationMonth: 13, // invalid
      expirationYear: 2027,
      cvv: '123',
    };

    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(false);
  });

  it('should reject card with month 0', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane',
      number: '4111111111111111',
      expirationMonth: 0,
      expirationYear: 2027,
      cvv: '123',
    };

    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(false);
  });

  it('should reject card with CVV too short', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane',
      number: '4111111111111111',
      expirationMonth: 6,
      expirationYear: 2027,
      cvv: '12', // too short
    };

    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(false);
  });

  it('should accept 4-digit CVV (Amex)', () => {
    const card = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane',
      number: '378282246310005',
      expirationMonth: 6,
      expirationYear: 2027,
      cvv: '1234', // Amex has 4-digit CVV
    };

    const result = CardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });
});

describe('SecureNoteSchema', () => {
  it('should accept a valid secure note', () => {
    const note = {
      ...validBase,
      type: 'secure-note' as const,
      content: 'This is a secret note with sensitive information.',
    };

    const result = SecureNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it('should accept secure note with empty content', () => {
    const note = {
      ...validBase,
      type: 'secure-note' as const,
      content: '',
    };

    const result = SecureNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });
});

describe('VaultItemSchema (discriminated union)', () => {
  it('should discriminate by type: credential', () => {
    const item = {
      ...validBase,
      type: 'credential' as const,
      username: 'user',
      password: 'pass',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('credential');
    }
  });

  it('should discriminate by type: card', () => {
    const item = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane',
      number: '4111111111111111',
      expirationMonth: 6,
      expirationYear: 2027,
      cvv: '123',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('card');
    }
  });

  it('should discriminate by type: secure-note', () => {
    const item = {
      ...validBase,
      type: 'secure-note' as const,
      content: 'Secret!',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('secure-note');
    }
  });

  it('should reject invalid type', () => {
    const item = {
      ...validBase,
      type: 'unknown-type',
      data: 'whatever',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });
});

describe('common field validation', () => {
  it('should reject invalid UUID', () => {
    const item = {
      ...validBase,
      id: 'not-a-uuid',
      type: 'secure-note' as const,
      content: 'test',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  it('should reject invalid ISO date', () => {
    const item = {
      ...validBase,
      createdAt: '2024-01-01', // missing time part
      type: 'secure-note' as const,
      content: 'test',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  it('should default tags to empty array', () => {
    const item = {
      id: validId,
      name: 'No Tags',
      createdAt: now,
      updatedAt: now,
      type: 'secure-note' as const,
      content: 'test',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it('should default favorite to false', () => {
    const item = {
      id: validId,
      name: 'Not Favorite',
      createdAt: now,
      updatedAt: now,
      type: 'secure-note' as const,
      content: 'test',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.favorite).toBe(false);
    }
  });

  it('should reject empty name', () => {
    const item = {
      ...validBase,
      name: '',
      type: 'secure-note' as const,
      content: 'test',
    };

    const result = VaultItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });
});

describe('EncryptedVaultItemSchema', () => {
  it('should accept a valid encrypted item', () => {
    const item = {
      id: validId,
      type: 'credential' as const,
      encryptedData: new Uint8Array([1, 2, 3, 4]),
      createdAt: now,
      updatedAt: now,
    };

    const result = EncryptedVaultItemSchema.safeParse(item);
    expect(result.success).toBe(true);
  });

  it('should reject encrypted item without encryptedData', () => {
    const item = {
      id: validId,
      type: 'credential' as const,
      createdAt: now,
      updatedAt: now,
    };

    const result = EncryptedVaultItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  it('should accept all valid type values', () => {
    for (const type of ['credential', 'card', 'secure-note'] as const) {
      const item = {
        id: validId,
        type,
        encryptedData: new Uint8Array([1]),
        createdAt: now,
        updatedAt: now,
      };

      const result = EncryptedVaultItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });
});

describe('schema forward compatibility', () => {
  it('CredentialSchema preserves unknown properties', () => {
    const input = {
      ...validBase,
      type: 'credential' as const,
      username: 'user',
      password: 'pass',
      appIdentifiers: ['com.example.app'],
      futureField: 42,
    };

    const result = CredentialSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data.appIdentifiers).toEqual(['com.example.app']);
      expect(data.futureField).toBe(42);
    }
  });

  it('CardSchema preserves unknown properties', () => {
    const input = {
      ...validBase,
      type: 'card' as const,
      cardholderName: 'Jane Doe',
      number: '4111111111111111',
      expirationMonth: 12,
      expirationYear: 2027,
      cvv: '123',
      futureCardFeature: true,
    };

    const result = CardSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).futureCardFeature).toBe(true);
    }
  });

  it('SecureNoteSchema preserves unknown properties', () => {
    const input = {
      ...validBase,
      type: 'secure-note' as const,
      content: 'secret',
      richContent: { format: 'markdown' },
    };

    const result = SecureNoteSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).richContent).toEqual({
        format: 'markdown',
      });
    }
  });

  it('EncryptedVaultItemSchema preserves unknown properties', () => {
    const input = {
      id: validId,
      type: 'credential' as const,
      encryptedData: new Uint8Array([1, 2, 3]),
      createdAt: now,
      updatedAt: now,
      syncVersion: 3,
    };

    const result = EncryptedVaultItemSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).syncVersion).toBe(3);
    }
  });
});
