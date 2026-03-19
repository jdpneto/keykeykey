/**
 * iCloud sync adapter for KeyKeyKey.
 *
 * Uses a platform-supplied filesystem interface (ICloudFs) so that the native
 * iCloud Drive APIs on iOS/macOS can be injected without this package having
 * any native dependencies.
 *
 * Directory layout inside containerPath:
 *   {containerPath}/vault.enc            — encrypted vault blob
 *   {containerPath}/items/{id}.bin       — encrypted vault items
 */

import type { ISyncAdapter, SyncManifest } from './types.js';

/**
 * Platform-agnostic filesystem interface.
 * Mobile (expo-file-system) and desktop (Tauri fs plugin) both implement this.
 */
export interface ICloudFs {
  readFile(path: string): Promise<string | Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(directory: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
}

export interface ICloudConfig {
  /** Absolute path to the iCloud container directory. */
  containerPath: string;
  /** Platform-supplied filesystem implementation. */
  fs: ICloudFs;
}

export class ICloudAdapter implements ISyncAdapter {
  private readonly basePath: string;
  private readonly fs: ICloudFs;

  constructor(config: ICloudConfig) {
    this.basePath = config.containerPath;
    this.fs = config.fs;
  }

  private get vaultBlobPath(): string {
    return `${this.basePath}/vault.enc`;
  }

  private get legacyManifestPath(): string {
    return `${this.basePath}/manifest.json`;
  }

  private itemPath(id: string): string {
    return `${this.basePath}/items/${id}.bin`;
  }

  private get itemsDir(): string {
    return `${this.basePath}/items`;
  }

  async readVaultBlob(): Promise<Uint8Array | null> {
    const exists = await this.fs.exists(this.vaultBlobPath);
    if (!exists) return null;

    try {
      const raw = await this.fs.readFile(this.vaultBlobPath);
      if (raw instanceof Uint8Array) return raw;
      return new TextEncoder().encode(raw);
    } catch {
      return null;
    }
  }

  async writeVaultBlob(data: Uint8Array): Promise<void> {
    await this.fs.mkdir(this.basePath);
    await this.fs.writeFile(this.vaultBlobPath, data);
  }

  async readLegacyManifest(): Promise<SyncManifest | null> {
    const exists = await this.fs.exists(this.legacyManifestPath);
    if (!exists) return null;

    try {
      const raw = await this.fs.readFile(this.legacyManifestPath);
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      return JSON.parse(text) as SyncManifest;
    } catch {
      return null;
    }
  }

  async deleteLegacyManifest(): Promise<void> {
    try {
      await this.fs.deleteFile(this.legacyManifestPath);
    } catch {
      // File may not exist — that's fine.
    }
  }

  async readItem(id: string): Promise<Uint8Array | null> {
    const path = this.itemPath(id);
    const exists = await this.fs.exists(path);
    if (!exists) return null;

    const raw = await this.fs.readFile(path);
    if (raw instanceof Uint8Array) return raw;
    // Wrap string data (e.g. returned by some platform impls)
    return new TextEncoder().encode(raw);
  }

  async writeItem(id: string, data: Uint8Array): Promise<void> {
    await this.fs.mkdir(this.itemsDir);
    await this.fs.writeFile(this.itemPath(id), data);
  }

  async deleteItem(id: string): Promise<void> {
    try {
      await this.fs.deleteFile(this.itemPath(id));
    } catch {
      // File may not exist — that's fine.
    }
  }

  async listItems(): Promise<string[]> {
    try {
      const files = await this.fs.listFiles(this.itemsDir);
      return files.filter((f) => f.endsWith('.bin')).map((f) => f.slice(0, -4));
    } catch {
      return [];
    }
  }
}
