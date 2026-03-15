/**
 * Desktop storage helpers for PIN and biometric data via Tauri keyring.
 *
 * Uses the existing save_to_keyring/load_from_keyring/delete_from_keyring
 * Tauri commands in src-tauri/src/keyring_cmds.rs.
 */

import { invoke } from '@tauri-apps/api/core';

const KEY_PIN_DATA = 'keykeykey_pin_data';
const KEY_PIN_ATTEMPTS = 'keykeykey_pin_attempts';
const KEY_BIOMETRIC_DEK = 'keykeykey_biometric_dek';

// --- PIN data ---

export async function savePinDataToKeyring(data: string): Promise<void> {
  await invoke('save_to_keyring', { key: KEY_PIN_DATA, value: data });
}

export async function loadPinDataFromKeyring(): Promise<string | null> {
  return invoke<string | null>('load_from_keyring', { key: KEY_PIN_DATA });
}

export async function deletePinDataFromKeyring(): Promise<void> {
  await invoke('delete_from_keyring', { key: KEY_PIN_DATA });
}

// --- PIN attempt counter ---

export async function savePinAttemptsToKeyring(remaining: number): Promise<void> {
  await invoke('save_to_keyring', { key: KEY_PIN_ATTEMPTS, value: String(remaining) });
}

export async function loadPinAttemptsFromKeyring(): Promise<number | null> {
  const val = await invoke<string | null>('load_from_keyring', { key: KEY_PIN_ATTEMPTS });
  return val !== null ? parseInt(val, 10) : null;
}

export async function deletePinAttemptsFromKeyring(): Promise<void> {
  await invoke('delete_from_keyring', { key: KEY_PIN_ATTEMPTS });
}

// --- Biometric DEK ---

export async function saveBiometricDEKToKeyring(data: string): Promise<void> {
  await invoke('save_to_keyring', { key: KEY_BIOMETRIC_DEK, value: data });
}

export async function loadBiometricDEKFromKeyring(): Promise<string | null> {
  return invoke<string | null>('load_from_keyring', { key: KEY_BIOMETRIC_DEK });
}

export async function deleteBiometricDEKFromKeyring(): Promise<void> {
  await invoke('delete_from_keyring', { key: KEY_BIOMETRIC_DEK });
}
