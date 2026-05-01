import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export function hashEncryptedItem(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}
