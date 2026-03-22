import { describe, it, expect } from 'vitest';
import { serializeCsv } from './csv-serializer.js';
import { parseCsv } from '../import/csv-parser.js';

describe('CSV serializer', () => {
  it('serializes headers and rows', () => {
    const result = serializeCsv(['a', 'b', 'c'], [['1', '2', '3']]);
    expect(result).toBe('\uFEFFa,b,c\r\n1,2,3\r\n');
  });

  it('quotes fields containing commas', () => {
    const result = serializeCsv(['name'], [['Last, First']]);
    expect(result).toBe('\uFEFFname\r\n"Last, First"\r\n');
  });

  it('escapes double quotes inside fields', () => {
    const result = serializeCsv(['name'], [['say "hi"']]);
    expect(result).toBe('\uFEFFname\r\n"say ""hi"""\r\n');
  });

  it('quotes fields containing newlines', () => {
    const result = serializeCsv(['note'], [['line1\nline2']]);
    expect(result).toBe('\uFEFFnote\r\n"line1\nline2"\r\n');
  });

  it('handles empty fields', () => {
    const result = serializeCsv(['a', 'b'], [['', 'val']]);
    expect(result).toBe('\uFEFFa,b\r\n,val\r\n');
  });

  it('handles multiple rows', () => {
    const result = serializeCsv(['a'], [['1'], ['2'], ['3']]);
    expect(result).toBe('\uFEFFa\r\n1\r\n2\r\n3\r\n');
  });

  it('handles empty rows array', () => {
    const result = serializeCsv(['a', 'b'], []);
    expect(result).toBe('\uFEFFa,b\r\n');
  });

  it('round-trips through parseCsv', () => {
    const headers = ['name', 'url', 'notes'];
    const rows = [
      ['My Site', 'https://example.com', 'has "quotes" and, commas'],
      ['Other', 'https://other.com', 'line1\nline2'],
    ];
    const csv = serializeCsv(headers, rows);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.headers).toEqual(headers);
    expect(parsed.rows).toEqual(rows);
  });
});
