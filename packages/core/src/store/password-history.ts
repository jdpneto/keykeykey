/**
 * Pure helper for the "restore previous password" action.
 *
 * Returns the new (`password`, `passwordHistory`) pair after swapping the
 * credential's current password with the entry at `historyIndex`. The chosen
 * entry leaves history; the displaced current password is appended to the end
 * (newest position). Net history length is unchanged.
 *
 * Returns `null` when the chosen entry's password equals the current password
 * — this is a no-op and the caller should skip the mutation entirely.
 *
 * Throws `RangeError` when `historyIndex` is outside `[0, history.length - 1]`.
 *
 * Used by both the core vault store action and the extension popup, which has
 * to construct the `UPDATE_ITEM` IPC payload itself (state lives in the popup
 * but persistence happens in the background service worker).
 */
export interface PasswordHistoryEntry {
  password: string;
  changedAt: string;
}

export interface RebuildResult {
  password: string;
  passwordHistory: PasswordHistoryEntry[];
}

export function rebuildAfterRestore(
  currentPassword: string,
  history: PasswordHistoryEntry[],
  historyIndex: number,
  now: string,
): RebuildResult | null {
  if (historyIndex < 0 || historyIndex >= history.length) {
    throw new RangeError(`rebuildAfterRestore: historyIndex out of range (${historyIndex})`);
  }
  const chosen = history[historyIndex];
  if (chosen.password === currentPassword) return null;

  const remaining = history.filter((_, i) => i !== historyIndex);
  const passwordHistory = [...remaining, { password: currentPassword, changedAt: now }];
  return { password: chosen.password, passwordHistory };
}
