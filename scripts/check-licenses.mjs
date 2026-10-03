#!/usr/bin/env node
// Fail if any production dependency can only be used under a forbidden
// (copyleft / non-commercial) license. SPDX `OR` expressions pass when at
// least one alternative is allowed (e.g. node-forge "BSD-3-Clause OR GPL-2.0"
// is used under BSD-3-Clause); `AND` expressions fail if any part is forbidden.
import { execFileSync } from 'node:child_process';

const FORBIDDEN = /^(A?GPL|LGPL|SSPL|EUPL|CC-BY-NC)/i;

// -r: since pnpm 11, `licenses list` without it only covers the root project
// (which has no production dependencies here).
const raw = execFileSync('pnpm', ['-r', 'licenses', 'list', '--prod', '--json'], {
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

// A silent pass is worse than a failure: if the pnpm output format changes and
// nothing parses, refuse instead of reporting "all permissive".
const packageCount = Object.values(byLicense).reduce((n, pkgs) => n + pkgs.length, 0);
if (packageCount === 0) {
  console.error('❌ License check found no production packages — pnpm output format changed?');
  process.exit(1);
}

if (violations.length) {
  console.error('❌ Forbidden license in production dependencies:\n  ' + violations.join('\n  '));
  process.exit(1);
}
console.log(
  `✅ All production licenses are permissive (${packageCount} packages, ${Object.keys(byLicense).length} license expressions).`,
);
