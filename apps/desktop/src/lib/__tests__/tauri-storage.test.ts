import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  saveVaultHeader,
  loadVaultHeader,
  saveEncryptedItem,
  loadAllEncryptedItems,
  deleteEncryptedItem,
  setVaultSetupComplete,
  isVaultSetupComplete,
} from '../tauri-storage';

const mockInvoke = vi.mocked(invoke);

describe('tauri-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveVaultHeader', () => {
    it('calls invoke with correct command and args', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await saveVaultHeader('base64data');
      expect(mockInvoke).toHaveBeenCalledWith('save_vault_header', { data: 'base64data' });
    });
  });

  describe('loadVaultHeader', () => {
    it('returns header string from invoke', async () => {
      mockInvoke.mockResolvedValueOnce('headerB64');
      const result = await loadVaultHeader();
      expect(mockInvoke).toHaveBeenCalledWith('load_vault_header');
      expect(result).toBe('headerB64');
    });

    it('returns null when no header exists', async () => {
      mockInvoke.mockResolvedValueOnce(null);
      const result = await loadVaultHeader();
      expect(result).toBeNull();
    });
  });

  describe('saveEncryptedItem', () => {
    it('calls invoke with correct args', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await saveEncryptedItem(
        'id-1',
        'credential',
        'enc64',
        '2024-01-01T00:00:00Z',
        '2024-01-01T00:00:00Z',
      );
      expect(mockInvoke).toHaveBeenCalledWith('save_encrypted_item', {
        id: 'id-1',
        itemType: 'credential',
        dataB64: 'enc64',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });
    });
  });

  describe('loadAllEncryptedItems', () => {
    it('returns array of stored items', async () => {
      const items = [
        { id: '1', type: 'credential', encrypted_data: 'a', created_at: 'x', updated_at: 'y' },
      ];
      mockInvoke.mockResolvedValueOnce(items);
      const result = await loadAllEncryptedItems();
      expect(mockInvoke).toHaveBeenCalledWith('load_all_encrypted_items');
      expect(result).toEqual(items);
    });
  });

  describe('deleteEncryptedItem', () => {
    it('calls invoke with correct args', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await deleteEncryptedItem('id-1');
      expect(mockInvoke).toHaveBeenCalledWith('delete_encrypted_item', { id: 'id-1' });
    });
  });

  describe('setVaultSetupComplete', () => {
    it('calls invoke with true', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await setVaultSetupComplete(true);
      expect(mockInvoke).toHaveBeenCalledWith('set_vault_setup_complete', { complete: true });
    });
  });

  describe('isVaultSetupComplete', () => {
    it('returns boolean from invoke', async () => {
      mockInvoke.mockResolvedValueOnce(true);
      const result = await isVaultSetupComplete();
      expect(mockInvoke).toHaveBeenCalledWith('is_vault_setup_complete');
      expect(result).toBe(true);
    });
  });
});
