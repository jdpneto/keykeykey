/**
 * Passes a scanned `otpauth://` URI from the QR scanner screen back to
 * whichever add/edit screen opened it.
 *
 * Used instead of router params because:
 *   - expo-router navigation params are limited in size and get serialized.
 *   - The add/edit screens stay mounted while the scanner opens as a modal,
 *     so we can consume the value in a `useFocusEffect` when they regain focus.
 */
export class TotpScanHandoff {
  private static pending: string | null = null;

  static set(uri: string): void {
    TotpScanHandoff.pending = uri;
  }

  static consume(): string | null {
    const value = TotpScanHandoff.pending;
    TotpScanHandoff.pending = null;
    return value;
  }

  static clear(): void {
    TotpScanHandoff.pending = null;
  }
}
