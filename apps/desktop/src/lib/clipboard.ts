import { invoke } from '@tauri-apps/api/core';

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyWithAutoClear(text: string, timeoutMs = 30_000): Promise<void> {
  await navigator.clipboard.writeText(text);
  setTimeout(async () => {
    try {
      await invoke('clear_clipboard');
    } catch {
      try {
        await navigator.clipboard.writeText('');
      } catch {
        // Clipboard clears are best-effort if both native and web APIs are denied.
      }
    }
  }, timeoutMs);
}
