import { describe, it, expect } from 'vitest';
import { parseBitwardenCsv } from './bitwarden.js';

// Test data based on real Bitwarden export format
const BITWARDEN_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,,login,1password,A3-RECOVERY-KEY,,0,,user@email.com,pass1,
,,login,9gag.com,,,0,https://9gag.com/,user@email.com,pass2,
,,login,account.acer.com,,,0,https://account.acer.com/sso/signin,user@email.com,pass3,
,,login,account.dji.com,,,0,https://account.dji.com/login?appId=my-store-be&backUrl=https%3A%2F%2Fmy.dji.com%2F&locale=en_US,user@email.com,pass4,
MIC,,login,account.jetbrains.com,,,0,https://account.jetbrains.com/licenses,mic-user,pass5,
,,login,account.jetbrains.com,,,0,https://account.jetbrains.com/login,other-user,pass6,
,,login,with-totp,,,0,https://totp-site.com,totpuser,totppass,otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP
,1,login,favorite-item,,,0,https://fav.com,favuser,favpass,
,,note,My Secure Note,This is secret,,0,,,,
,,card,My Credit Card,,,0,,,,
`;

describe('Bitwarden CSV importer', () => {
  it('imports only login type entries', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    // 8 login rows in total
    expect(items.length).toBe(8);
  });

  it('skips non-login types (note, card)', () => {
    const { skipped } = parseBitwardenCsv(BITWARDEN_CSV);
    const noteSkip = skipped.find((s) => s.reason.includes('note'));
    const cardSkip = skipped.find((s) => s.reason.includes('card'));
    expect(noteSkip).toBeDefined();
    expect(cardSkip).toBeDefined();
  });

  it('uses the name column as item name', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    expect(items[0].name).toBe('1password');
    expect(items[1].name).toBe('9gag.com');
  });

  it('preserves notes', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    expect(items[0].notes).toBe('A3-RECOVERY-KEY');
  });

  it('normalizes URLs (strips query params for cleaner display)', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    const dji = items.find((i) => i.name === 'account.dji.com');
    expect(dji?.url).toBe('https://account.dji.com/login');
  });

  it('preserves folder names', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    const mic = items.find((i) => i.username === 'mic-user');
    expect(mic?.folder).toBe('MIC');
  });

  it('preserves favorite flag', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    const fav = items.find((i) => i.name === 'favorite-item');
    expect(fav?.favorite).toBe(true);

    // Non-favorites should be false
    const nonFav = items.find((i) => i.name === '9gag.com');
    expect(nonFav?.favorite).toBe(false);
  });

  it('preserves TOTP seeds', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    const totp = items.find((i) => i.name === 'with-totp');
    expect(totp?.totp).toContain('otpauth://totp/');
    expect(totp?.totp).toContain('JBSWY3DPEHPK3PXP');
  });

  it('handles entries with empty login_uri', () => {
    const { items } = parseBitwardenCsv(BITWARDEN_CSV);
    const noUri = items.find((i) => i.name === '1password');
    expect(noUri?.url).toBe('');
  });

  it('throws on invalid headers', () => {
    expect(() => parseBitwardenCsv('foo,bar,baz\n1,2,3')).toThrow('Invalid Bitwarden CSV');
  });

  it('handles empty CSV body', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n';
    const { items } = parseBitwardenCsv(csv);
    expect(items).toEqual([]);
  });
});
