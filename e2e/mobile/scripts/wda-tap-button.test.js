import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./wda-tap-button.js', import.meta.url), 'utf8');

test('clicks a visible WDA button by exact text', () => {
  const calls = [];
  const context = {
    BUTTON_TEXT: 'Delete',
    output: {},
    console: {
      log() {},
    },
    http: {
      get(url) {
        calls.push(['GET', url]);
        if (url.endsWith('/status')) return { status: 200, body: '{"value":{}}' };
        if (url.endsWith('/sessions')) return { status: 404, body: '{"sessionId":"abc"}' };
        throw new Error('unexpected GET ' + url);
      },
      post(url, options) {
        calls.push(['POST', url, JSON.parse(options.body)]);
        if (url.endsWith('/session/abc/element')) {
          return {
            status: 200,
            body: JSON.stringify({
              value: {
                ELEMENT: 'button-1',
              },
            }),
          };
        }
        if (url.endsWith('/session/abc/element/button-1/click')) {
          return { status: 200, body: '{"value":null}' };
        }
        throw new Error('unexpected POST ' + url);
      },
    },
  };

  vm.runInNewContext(source, context);

  assert.deepEqual(calls, [
    ['GET', 'http://127.0.0.1:8418/status'],
    ['GET', 'http://127.0.0.1:8418/sessions'],
    [
      'POST',
      'http://127.0.0.1:8418/session/abc/element',
      {
        using: 'predicate string',
        value: 'type == "XCUIElementTypeButton" AND (name == "Delete" OR label == "Delete")',
      },
    ],
    ['POST', 'http://127.0.0.1:8418/session/abc/element/button-1/click', {}],
  ]);
});
