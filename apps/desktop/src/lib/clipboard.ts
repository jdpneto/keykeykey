export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyWithAutoClear(text: string, timeoutMs = 30_000): Promise<void> {
  await navigator.clipboard.writeText(text);
  setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === text) {
        await navigator.clipboard.writeText('');
      }
    } catch {
      // Clipboard read may fail if window lost focus
    }
  }, timeoutMs);
}
