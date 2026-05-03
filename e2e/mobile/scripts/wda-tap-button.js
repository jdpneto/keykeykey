// Click a native iOS alert/action button through the active WebDriverAgent session.
//
// DeviceLab maestro-runner can report success for `tapOn: "Delete"` on a
// physical iPhone while the native Alert button remains visible. Use this
// helper for exact button clicks when WDA is available, and keep a normal
// Maestro tap as the flow fallback for non-WDA targets.
//
// Required env:
//   BUTTON_TEXT - exact button name/label to click.

function request(method, path, body) {
  var url = 'http://127.0.0.1:8418' + path;
  var options = {
    headers: { 'Content-Type': 'application/json' },
  };
  if (typeof body !== 'undefined') {
    options.body = JSON.stringify(body);
  }

  var res = method === 'GET' ? http.get(url, options) : http.post(url, options);
  var parsed = {};
  try {
    parsed = res && res.body ? JSON.parse(res.body) : {};
  } catch (_err) {
    parsed = {};
  }

  return {
    status: res && res.status,
    body: parsed,
  };
}

function post(path, body) {
  var res = request('POST', path, body || {});
  if (res.status < 200 || res.status >= 300) {
    throw new Error('[wda-tap-button] POST ' + path + ' failed with status ' + res.status);
  }
  return res.body;
}

function isWdaAvailable() {
  try {
    var res = request('GET', '/status');
    return !!(res && res.status >= 200 && res.status < 500);
  } catch (_err) {
    return false;
  }
}

function getActiveSessionId() {
  var res = request('GET', '/sessions');
  return res.body && res.body.sessionId;
}

function elementId(response) {
  var value = response && response.value ? response.value : {};
  return value['element-6066-11e4-a52e-4f735466cecf'] || value.ELEMENT;
}

function escapePredicateLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findButton(sessionId, text) {
  var escaped = escapePredicateLiteral(text);
  var response = post('/session/' + sessionId + '/element', {
    using: 'predicate string',
    value:
      'type == "XCUIElementTypeButton" AND (name == "' +
      escaped +
      '" OR label == "' +
      escaped +
      '")',
  });
  var id = elementId(response);
  if (!id) {
    throw new Error('[wda-tap-button] button not found: ' + text);
  }
  return id;
}

if (!BUTTON_TEXT) {
  throw new Error('[wda-tap-button] BUTTON_TEXT is required');
}

if (!isWdaAvailable()) {
  output.wdaSkipped = 'true';
  console.log('[wda-tap-button] skipped ' + BUTTON_TEXT + ' because WDA is unavailable');
} else {
  var sessionId = getActiveSessionId();
  if (!sessionId) {
    throw new Error('[wda-tap-button] active WDA session id missing');
  }

  var id = findButton(sessionId, BUTTON_TEXT);
  post('/session/' + sessionId + '/element/' + id + '/click', {});
  output.wdaTappedButton = 'true';
  console.log('[wda-tap-button] tapped ' + BUTTON_TEXT);
}
