import { describe, it, expect } from 'vitest';
import { createDEKHolder } from './dek-holder.js';

describe('createDEKHolder', () => {
  it('require throws when no DEK is set', () => {
    const holder = createDEKHolder();
    expect(() => holder.require()).toThrow('Vault is locked');
  });

  it('require returns the DEK after set', () => {
    const holder = createDEKHolder();
    const dek = new Uint8Array([1, 2, 3, 4]);
    holder.set(dek);
    expect(holder.require()).toBe(dek);
  });

  it('clear zeroes the underlying buffer', () => {
    const holder = createDEKHolder();
    const dek = new Uint8Array([1, 2, 3, 4]);
    holder.set(dek);
    holder.clear();
    // The original buffer the caller handed in must be wiped — a heap snapshot
    // taken after lock should not recover the key bytes.
    expect(Array.from(dek)).toEqual([0, 0, 0, 0]);
  });

  it('clear releases the reference (require throws afterwards)', () => {
    const holder = createDEKHolder();
    holder.set(new Uint8Array(32));
    holder.clear();
    expect(() => holder.require()).toThrow('Vault is locked');
  });

  it('clear is idempotent — calling on an empty holder is a no-op', () => {
    const holder = createDEKHolder();
    expect(() => holder.clear()).not.toThrow();
    expect(() => holder.clear()).not.toThrow();
    expect(() => holder.require()).toThrow('Vault is locked');
  });

  it('set after clear re-installs a DEK', () => {
    const holder = createDEKHolder();
    holder.set(new Uint8Array([9]));
    holder.clear();
    const next = new Uint8Array([7, 7]);
    holder.set(next);
    expect(holder.require()).toBe(next);
  });
});
