import { ask, message } from '@tauri-apps/plugin-dialog';

/**
 * Native confirmation/error dialogs.
 *
 * Never use `window.confirm` / `window.alert` in the desktop app: the Tauri
 * webview shows nothing for them, and `confirm()` returns true — so a
 * "Delete … ?" guard deleted immediately and error alerts were silently lost.
 */
export function confirmAction(
  text: string,
  options: { okLabel?: string; destructive?: boolean } = {},
): Promise<boolean> {
  return ask(text, {
    title: 'KeyKeyKey',
    kind: options.destructive ? 'warning' : 'info',
    okLabel: options.okLabel ?? 'OK',
    cancelLabel: 'Cancel',
  });
}

export async function showError(text: string): Promise<void> {
  await message(text, { title: 'KeyKeyKey', kind: 'error' });
}
