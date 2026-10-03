#!/usr/bin/env node
// Fail if any production dependency can only be used under a forbidden
// (copyleft / non-commercial) license. SPDX `OR` expressions pass when at
// least one alternative is allowed (e.g. node-forge "BSD-3-Clause OR GPL-2.0"
// is used under BSD-3-Clause); `AND` expressions fail if any part is forbidden.
import { execFileSync } from 'node:child_process';

const FORBIDDEN = /^(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC)/i;

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);

const isForbidden = (expr) => {
  const e = expr.trim().replace(/^\((.*)\)$/, '$1');
  if (/\sOR\s/i.test(e)) return e.split(/\sOR\s/i).every(isForbidden);
  if (/\sAND\s/i.test(e)) return e.split(/\sAND\s/i).some(isForbidden);
  return FORBIDDEN.test(e.replace(/[()]/g, ''));
};

const violations = Object.entries(byLicense)
  .filter(([license]) => isForbidden(license))
  .flatMap(([license, pkgs]) => pkgs.map((p) => `${p.name}@${p.versions?.join(',')} (${license})`));

if (violations.length) {
  console.error('❌ Forbidden license in production dependencies:\n  ' + violations.join('\n  '));
  process.exit(1);
}
console.log(
  `✅ All production licenses are permissive (${Object.keys(byLicense).length} license expressions checked).`,
);
