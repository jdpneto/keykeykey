import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv-parser.js';

describe('CSV parser', () => {
  it('parses simple unquoted CSV with header', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(['a', 'b', 'c']);
    expect(result.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('parses CSV without header row', () => {
    const csv = '1,2,3\n4,5,6\n';
    const result = parseCsv(csv, { hasHeader: false });
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields', () => {
    const csv = '"name","url"\n"hello","world"\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(['name', 'url']);
    expect(result.rows).toEqual([['hello', 'world']]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'a,b\n"he said ""hi""","ok"\n';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['he said "hi"', 'ok']);
  });

  it('handles empty fields', () => {
    const csv = 'a,b,c\n,hello,\n';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['', 'hello', '']);
  });

  it('handles CRLF line endings', () => {
    const csv = 'a,b\r\n1,2\r\n3,4\r\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles newlines inside quoted fields', () => {
    const csv = 'a,b\n"line1\nline2","ok"\n';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['line1\nline2', 'ok']);
  });

  it('handles empty CSV', () => {
    const result = parseCsv('');
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it('handles CSV with only headers', () => {
    const result = parseCsv('a,b,c\n');
    expect(result.headers).toEqual(['a', 'b', 'c']);
    expect(result.rows).toEqual([]);
  });

  it('handles trailing comma (empty last field)', () => {
    const csv = 'a,b,c\n1,2,\n';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['1', '2', '']);
  });

  it('parses mixed quoted and unquoted fields', () => {
    const csv = 'a,b,c\nhello,"world, there",test\n';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['hello', 'world, there', 'test']);
  });

  it('handles fields with commas inside quotes', () => {
    const csv = 'name,url\n"Last, First","https://example.com"\n';
    const result = parseCsv(csv);
    expect(result.rows[0]).toEqual(['Last, First', 'https://example.com']);
  });

  it('handles JSON inside quoted fields (Firefox format)', () => {
    // CSV escaping uses "" not \", so use the real format
    const csvWithJson = '"url","username","password"\n"chrome://FF","user","{""version"":1}"\n';
    const result = parseCsv(csvWithJson);
    expect(result.rows[0][2]).toBe('{"version":1}');
  });

  it('handles UTF-8 BOM prefix', () => {
    const csv = '\uFEFFa,b,c\n1,2,3\n';
    const result = parseCsv(csv);
    expect(result.headers).toEqual(['a', 'b', 'c']);
    expect(result.rows).toEqual([['1', '2', '3']]);
  });
});
