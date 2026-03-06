import { describe, it, expect } from 'vitest';
import { parseOnePasswordCsv } from './onepassword.js';

// Test data based on real 1Password headerless export format
const ONEPASSWORD_CSV = `,"It's you! Select Edit to fill in more details.",,"David Neto","Identity",,"",
,"https://www.radiopopular.pt",,"https://www.radiopopular.pt","Login","user@email.com","pass1",
,"https://penguinformula.slack.com",,"https://penguinformula.slack.com","Login","david@company.com","pass2",
,"https://accounts.google.com",,"https://accounts.google.com","Login","user@gmail.com","pass3",
,"https://www.burgerking.pt",,"https://www.burgerking.pt","Login","","pass4",
`;

describe('1Password CSV importer (headerless)', () => {
  it('parses headerless 1Password export entries', () => {
    const { items } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    expect(items.length).toBe(4);
  });

  it('skips Identity type entries', () => {
    const { skipped } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    const identity = skipped.find((s) => s.reason.includes('Identity'));
    expect(identity).toBeDefined();
  });

  it('derives name from URL hostname', () => {
    const { items } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    expect(items[0].name).toBe('www.radiopopular.pt');
    expect(items[1].name).toBe('penguinformula.slack.com');
  });

  it('normalizes URLs', () => {
    const { items } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    expect(items[0].url).toBe('https://www.radiopopular.pt');
    expect(items[2].url).toBe('https://accounts.google.com');
  });

  it('preserves username and password', () => {
    const { items } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    expect(items[0].username).toBe('user@email.com');
    expect(items[0].password).toBe('pass1');
  });

  it('imports entries with empty username but valid password', () => {
    const { items } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    const bk = items.find((i) => i.name === 'www.burgerking.pt');
    expect(bk).toBeDefined();
    expect(bk?.username).toBe('');
    expect(bk?.password).toBe('pass4');
  });

  it('skips rows with too few columns', () => {
    const csv = 'a,b,c\n';
    const { items, skipped } = parseOnePasswordCsv(csv);
    expect(items).toHaveLength(0);
    expect(skipped[0].reason).toContain('Too few columns');
  });

  it('skips rows with no username AND no password', () => {
    const csv = ',"https://test.com",,"https://test.com","Login","","",\n';
    const { items, skipped } = parseOnePasswordCsv(csv);
    expect(items).toHaveLength(0);
    expect(skipped[0].reason).toContain('No username or password');
  });

  it('handles various non-Login types', () => {
    const csv = `,"note text",,"My Note","Secure Note","","",
,"https://bank.com",,"Bank Card","Credit Card","","",
,"https://site.com",,"https://site.com","Login","user","pass",
`;
    const { items, skipped } = parseOnePasswordCsv(csv);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('site.com');
    expect(skipped.length).toBe(2);
  });

  it('sets default values for notes, totp, folder, favorite', () => {
    const { items } = parseOnePasswordCsv(ONEPASSWORD_CSV);
    for (const item of items) {
      expect(item.notes).toBe('');
      expect(item.totp).toBe('');
      expect(item.folder).toBe('');
      expect(item.favorite).toBe(false);
    }
  });
});
