/**
 * RFC 4180-compliant CSV serializer.
 *
 * Produces UTF-8 with BOM, CRLF line endings, and proper quoting.
 */

const BOM = '\uFEFF';

/**
 * Serialize headers and rows into an RFC 4180 CSV string.
 *
 * Fields containing commas, double quotes, or newlines are double-quoted.
 * Internal double quotes are escaped as "".
 * Output uses CRLF line endings and a UTF-8 BOM prefix.
 */
export function serializeCsv(headers: string[], rows: string[][]): string {
  const lines: string[] = [serializeRow(headers)];
  for (const row of rows) {
    lines.push(serializeRow(row));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

function serializeRow(fields: string[]): string {
  return fields.map(quoteField).join(',');
}

function quoteField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}
