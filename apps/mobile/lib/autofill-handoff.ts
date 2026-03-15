export interface PendingCredential {
  username: string;
  password: string;
  packageName: string;
  domain?: string;
}

export class AutofillHandoff {
  private static pending: PendingCredential | null = null;

  static setPending(credential: PendingCredential): void {
    AutofillHandoff.pending = credential;
  }

  static consume(): PendingCredential | null {
    const result = AutofillHandoff.pending;
    AutofillHandoff.pending = null;
    return result;
  }

  static clear(): void {
    AutofillHandoff.pending = null;
  }
}
