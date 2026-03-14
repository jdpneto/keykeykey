import { useState, useEffect, useCallback } from 'react';
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
  }, [refresh]);

  return { ...status, refresh };
}
