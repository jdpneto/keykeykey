import { invoke } from '@tauri-apps/api/core';

export type StoredItem = {
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
};

export async function saveVaultHeader(headerBase64: string): Promise<void> {
  await invoke('save_vault_header', { data: headerBase64 });
}

export async function loadVaultHeader(): Promise<string | null> {
  return invoke<string | null>('load_vault_header');
}

export async function saveEncryptedItem(
  id: string,
  type: string,
  encryptedDataBase64: string,
  createdAt: string,
  updatedAt: string,
): Promise<void> {
  await invoke('save_encrypted_item', {
    id,
    itemType: type,
    dataB64: encryptedDataBase64,
    createdAt,
    updatedAt,
  });
}

export async function loadAllEncryptedItems(): Promise<StoredItem[]> {
  return invoke<StoredItem[]>('load_all_encrypted_items');
}

export async function deleteEncryptedItem(id: string): Promise<void> {
  await invoke('delete_encrypted_item', { id });
}

export async function setVaultSetupComplete(complete: boolean): Promise<void> {
  await invoke('set_vault_setup_complete', { complete });
}

export async function isVaultSetupComplete(): Promise<boolean> {
  return invoke<boolean>('is_vault_setup_complete');
}
