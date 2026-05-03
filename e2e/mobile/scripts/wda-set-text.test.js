import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./wda-set-text.js', import.meta.url), 'utf8');

test('skips when WebDriverAgent is unavailable', () => {
  const context = {
    FIELD_ID: 'setup-password',
    TEXT: 'test1234',
    output: {},
    console: {
      log() {},
    },
    http: {
      get() {
        throw new Error('Failed to connect to /127.0.0.1:8418');
      },
      post() {
        throw new Error('unexpected post');
      },
    },
  };

  vm.runInNewContext(source, context);

  assert.equal(context.output.wdaSkipped, 'true');
});
