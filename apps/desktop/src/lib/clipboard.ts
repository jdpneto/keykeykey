export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyWithAutoClear(text: string, timeoutMs = 30_000): Promise<void> {
  await navigator.clipboard.writeText(text);
  setTimeout(async () => {
    try {
      await navigator.clipboard.writeText('');
    } catch {
      // Clipboard writes can fail if the OS denies access after the window loses focus.
    }
  }, timeoutMs);
}
