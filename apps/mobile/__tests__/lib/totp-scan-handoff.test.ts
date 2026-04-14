import { TotpScanHandoff } from '@/lib/totp-scan-handoff';

describe('TotpScanHandoff', () => {
  afterEach(() => {
    TotpScanHandoff.clear();
  });

  it('returns null when nothing has been set', () => {
    expect(TotpScanHandoff.consume()).toBeNull();
  });

  it('returns the set value and clears it on first consume', () => {
    TotpScanHandoff.set('otpauth://totp/X?secret=JBSWY3DPEHPK3PXP');
    expect(TotpScanHandoff.consume()).toBe('otpauth://totp/X?secret=JBSWY3DPEHPK3PXP');
    expect(TotpScanHandoff.consume()).toBeNull();
  });

  it('overwrites prior pending value when set again', () => {
    TotpScanHandoff.set('first');
    TotpScanHandoff.set('second');
    expect(TotpScanHandoff.consume()).toBe('second');
  });

  it('clear() drops a pending value', () => {
    TotpScanHandoff.set('pending');
    TotpScanHandoff.clear();
    expect(TotpScanHandoff.consume()).toBeNull();
  });
});
