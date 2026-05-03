#!/usr/bin/env node

const envKeys = (process.env.REDACT_ENV_KEYS || 'KKK_WEBDAV_PASS,KKK_WEBDAV_USER,KKK_WEBDAV_URL')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);

const secrets = envKeys
  .map((key) => process.env[key])
  .filter(Boolean)
  .sort((a, b) => b.length - a.length);

let carry = '';

function redact(value) {
  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted.replace(/\binputText:\s*"([^"\\]|\\.)*"/g, 'inputText: "[REDACTED]"');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const data = carry + chunk;
  const newlineIndex = data.lastIndexOf('\n');

  if (newlineIndex === -1) {
    carry = data;
    return;
  }

  process.stdout.write(redact(data.slice(0, newlineIndex + 1)));
  carry = data.slice(newlineIndex + 1);
});

process.stdin.on('end', () => {
  process.stdout.write(redact(carry));
});
