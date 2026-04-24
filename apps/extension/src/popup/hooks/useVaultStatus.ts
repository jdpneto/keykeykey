import { useState, useEffect, useCallback } from 'react';
import browser from 'webextension-polyfill';
import { sendMessage } from './useMessage.js';
import type { VaultStatusResponse } from '../../lib/messages.js';

export function useVaultStatus() {
  const [status, setStatus] = useState<VaultStatusResponse>({
    status: 'loading',
    hasPIN: false,
    itemCount: 0,
  });

  const refresh = useCallback(async () => {
    const response = await sendMessage<VaultStatusResponse>({ type: 'GET_STATUS' });
    setStatus(response);
  }, []);

  useEffect(() => {
    refresh();

    // Re-poll status when the background broadcasts a vault lifecycle event.
    // Without this, the popup stays on a stale vault-list view when the
    // background auto-locks — the user would see decrypted items while the
    // vault is actually locked.
    const listener = (msg: unknown) => {
      if (typeof msg === 'object' && msg !== null && 'type' in msg) {
        const type = (msg as { type: string }).type;
        if (type === 'VAULT_LOCKED' || type === 'VAULT_UNLOCKED' || type === 'VAULT_CHANGED') {
          refresh();
        }
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);

  return { ...status, refresh };
}
