/**
 * Minimal RFC 4180-compliant CSV parser.
 *
 * Handles quoted fields, escaped quotes (""), newlines inside quotes,
 * and both CRLF and LF line endings. No external dependencies.
 */

export interface CsvParseResult {
  /** Column headers (first row), if present. */
  headers: string[];
  /** Data rows as arrays of field strings. */
  rows: string[][];
}

/**
 * Parse a CSV string into headers and rows.
 *
 * @param csv - Raw CSV content (UTF-8 string)
 * @param options.hasHeader - Whether the first row contains column names (default: true)
 * @returns Parsed headers and rows
 */
export function parseCsv(csv: string, options: { hasHeader?: boolean } = {}): CsvParseResult {
  // Strip UTF-8 BOM if present (common in exported CSVs)
  if (csv.charCodeAt(0) === 0xfeff) {
    csv = csv.slice(1);
  }

  const { hasHeader = true } = options;
  const allRows = parseRows(csv);

  if (allRows.length === 0) {
    return { headers: [], rows: [] };
  }

  if (hasHeader) {
    const [first, ...rows] = allRows;
    return { headers: first!, rows };
  }

  return { headers: [], rows: allRows };
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = csv.length;

  while (i < len) {
    const { row, nextIndex } = parseRow(csv, i);
    // Skip completely empty trailing rows
    if (nextIndex === len && row.length === 1 && row[0] === '') {
      break;
    }
    rows.push(row);
    i = nextIndex;
  }

  return rows;
}

function parseRow(csv: string, start: number): { row: string[]; nextIndex: number } {
  const fields: string[] = [];
  let i = start;
  const len = csv.length;

  while (i <= len) {
    if (i === len) {
      // End of input — push empty field only if we just saw a comma
      if (fields.length > 0 && csv[i - 1] === ',') {
        fields.push('');
      } else if (fields.length === 0) {
        fields.push('');
      }
      return { row: fields, nextIndex: i };
    }

    if (csv[i] === '"') {
      // Quoted field
      const { value, nextIndex } = parseQuotedField(csv, i);
      fields.push(value);
      i = nextIndex;
    } else {
      // Unquoted field — read until comma or newline
      let fieldEnd = i;
      while (
        fieldEnd < len &&
        csv[fieldEnd] !== ',' &&
        csv[fieldEnd] !== '\n' &&
        csv[fieldEnd] !== '\r'
      ) {
        fieldEnd++;
      }
      fields.push(csv.slice(i, fieldEnd));
      i = fieldEnd;
    }

    // After field, check delimiter
    if (i >= len) {
      return { row: fields, nextIndex: i };
    }

    if (csv[i] === ',') {
      i++; // consume comma, continue to next field
      // If comma is the last character, add empty trailing field
      if (i >= len) {
        fields.push('');
        return { row: fields, nextIndex: i };
      }
      // If comma is right before newline, add empty field
      if (csv[i] === '\n' || csv[i] === '\r') {
        fields.push('');
        // Consume newline
        if (csv[i] === '\r' && i + 1 < len && csv[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        return { row: fields, nextIndex: i };
      }
    } else if (csv[i] === '\r' || csv[i] === '\n') {
      // End of row
      if (csv[i] === '\r' && i + 1 < len && csv[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      return { row: fields, nextIndex: i };
    }
  }

  return { row: fields, nextIndex: i };
}

function parseQuotedField(csv: string, start: number): { value: string; nextIndex: number } {
  let i = start + 1; // skip opening quote
  const len = csv.length;
  let value = '';

  while (i < len) {
    if (csv[i] === '"') {
      if (i + 1 < len && csv[i + 1] === '"') {
        // Escaped quote
        value += '"';
        i += 2;
      } else {
        // End of quoted field
        i++; // skip closing quote
        return { value, nextIndex: i };
      }
    } else {
      value += csv[i];
      i++;
    }
  }

  // Unterminated quoted field — return what we have
  return { value, nextIndex: i };
}
