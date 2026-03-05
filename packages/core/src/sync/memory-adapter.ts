/**
 * In-memory sync adapter for testing.
 *
 * Implements ISyncAdapter using simple Maps — no I/O.
 * Useful for unit tests and as a reference implementation.
 */

import type { ISyncAdapter, SyncManifest } from './types.js';

export class MemoryAdapter implements ISyncAdapter {
  private manifest: SyncManifest | null = null;
  private items = new Map<string, Uint8Array>();

  async readManifest(): Promise<SyncManifest | null> {
    return this.manifest ? structuredClone(this.manifest) : null;
  }

  async writeManifest(manifest: SyncManifest): Promise<void> {
    this.manifest = structuredClone(manifest);
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
