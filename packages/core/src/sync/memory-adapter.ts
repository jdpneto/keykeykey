/**
 * In-memory sync adapter for testing.
 *
 * Implements ISyncAdapter using simple Maps — no I/O.
 * Useful for unit tests and as a reference implementation.
 */

import type { ISyncAdapter, SyncManifest } from './types.js';

export class MemoryAdapter implements ISyncAdapter {
  private vaultBlob: Uint8Array | null = null;
  private legacyManifest: SyncManifest | null = null;
  private items = new Map<string, Uint8Array>();

  async readVaultBlob(): Promise<Uint8Array | null> {
    return this.vaultBlob ? new Uint8Array(this.vaultBlob) : null;
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    this.vaultBlob = new Uint8Array(data);
  }

  /** Set a legacy manifest for migration testing. */
  setLegacyManifest(manifest: SyncManifest): void {
    this.legacyManifest = structuredClone(manifest);
  }

  async readLegacyManifest(): Promise<SyncManifest | null> {
    return this.legacyManifest ? structuredClone(this.legacyManifest) : null;
  }

  async deleteLegacyManifest(): Promise<void> {
    this.legacyManifest = null;
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const data = this.items.get(id);
    return data ? new Uint8Array(data) : null;
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    this.items.set(id, new Uint8Array(data));
  }

  async deleteItem(id: string): Promise<void> {
    this.items.delete(id);
  }

  async listItems(): Promise<string[]> {
    return Array.from(this.items.keys());
  }
}
