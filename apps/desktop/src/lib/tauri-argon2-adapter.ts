import { invoke } from '@tauri-apps/api/core';
import type { Argon2Adapter } from '@keykeykey/core';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const tauriArgon2Adapter: Argon2Adapter = {
  async hash(password, salt, params) {
    const resultB64 = await invoke<string>('argon2_hash', {
      passwordB64: toBase64(password),
      saltB64: toBase64(salt),
      t: params.t,
      m: params.m,
      p: params.p,
      dkLen: params.dkLen,
    });
    return fromBase64(resultB64);
  },
};
