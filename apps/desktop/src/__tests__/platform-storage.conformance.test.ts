import { vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { describePlatformStorageConformance } from '@keykeykey/core/testing';
import { createDesktopPlatformStorage } from '../lib/sync';

const mockInvoke = vi.mocked(invoke);

// Stateful mock that simulates the Tauri storage backend
let vaultHeader: string | null = null;
let syncConfig: string | null = null; // base64-encoded
let setupComplete = false;
let syncUrlPrefix: string | null = null;
const items: Array<{
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
}> = [];

function resetMockState() {
  vaultHeader = null;
  syncConfig = null;
  setupComplete = false;
  syncUrlPrefix = null;
  items.length = 0;
  mockInvoke.mockReset();
  installMockHandlers();
}

function installMockHandlers() {
  mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'save_vault_header':
        vaultHeader = args!.data as string;
        return undefined;
      case 'load_vault_header':
        return vaultHeader;
      case 'save_encrypted_item': {
        const idx = items.findIndex((i) => i.id === (args!.id as string));
        const row = {
          id: args!.id as string,
          type: args!.itemType as string,
          encrypted_data: args!.dataB64 as string,
          created_at: args!.createdAt as string,
          updated_at: args!.updatedAt as string,
        };
        if (idx >= 0) items[idx] = row;
        else items.push(row);
        return undefined;
      }
      case 'load_all_encrypted_items':
        return [...items];
      case 'delete_encrypted_item': {
        const delIdx = items.findIndex((i) => i.id === (args!.id as string));
        if (delIdx >= 0) items.splice(delIdx, 1);
        return undefined;
      }
      case 'save_sync_config': {
        syncConfig = args!.dataB64 as string;
        return undefined;
      }
      case 'load_sync_config':
        return syncConfig;
      case 'delete_sync_config':
        syncConfig = null;
        return undefined;
      case 'set_vault_setup_complete':
        setupComplete = args!.complete as boolean;
        return undefined;
      case 'is_vault_setup_complete':
        return setupComplete;
      case 'set_sync_url_prefix':
        syncUrlPrefix = args!.prefix as string | null;
        return undefined;
      default:
        throw new Error(`Unexpected invoke command: ${cmd}`);
    }
  });
}

describePlatformStorageConformance('Desktop', () => {
  resetMockState();
  return createDesktopPlatformStorage();
});
