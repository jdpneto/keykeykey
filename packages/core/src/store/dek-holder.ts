/**
 * Holds the active Data Encryption Key for an unlocked vault.
 *
 * SECURITY: the DEK lives only in this closure, never in the vault store's
 * serializable state. `clear()` zeroes the buffer before releasing it so a
 * heap snapshot taken after lock cannot recover the key bytes.
 */
export interface DEKHolder {
  /** Install a DEK. Caller is responsible for not setting twice without clearing. */
  set: (dek: Uint8Array) => void;
  /** Zero the active DEK and release the reference. Idempotent. */
  clear: () => void;
  /** Return the active DEK, or throw `Error('Vault is locked')` if absent. */
  require: () => Uint8Array;
}

export function createDEKHolder(): DEKHolder {
  let activeDEK: Uint8Array | null = null;

  return {
    set: (dek) => {
      activeDEK = dek;
    },
    clear: () => {
      if (activeDEK) {
        activeDEK.fill(0);
        activeDEK = null;
      }
    },
    require: () => {
      if (!activeDEK) {
        throw new Error('Vault is locked');
      }
      return activeDEK;
    },
  };
}
