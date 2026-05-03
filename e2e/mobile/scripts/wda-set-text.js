// Set text directly through the active WebDriverAgent session.
//
// DeviceLab maestro-runner's `inputText` can report success on physical
// iPhones while leaving React Native TextInput values unchanged. This helper
// is intended as an optional correction step after normal `inputText`.
//
// Required env:
//   FIELD_ID - accessibility id / testID of the TextInput
//   TEXT     - text to write, or TEXT_VAR to resolve from a Maestro variable
//
// Optional env:
//   FORCE_SET - clear and send the value even when WDA already reports it.

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
    throw new Error('[wda-set-text] POST ' + path + ' failed with status ' + res.status);
  }
  return res.body;
}

function getActiveSessionId() {
  // WDA does not implement /sessions, but the error envelope includes the
  // active session id. If the runner uses a different driver, this will fail
  // and the optional runScript step will be ignored by the flow.
  var res = request('GET', '/sessions');
  return res.body && res.body.sessionId;
}

function elementId(response) {
  var value = response && response.value ? response.value : {};
  return value['element-6066-11e4-a52e-4f735466cecf'] || value.ELEMENT;
}

function findElement(sessionId, fieldId) {
  var response = post('/session/' + sessionId + '/element', {
    using: 'accessibility id',
    value: fieldId,
  });
  var id = elementId(response);
  if (!id) {
    throw new Error('[wda-set-text] element not found: ' + fieldId);
  }
  return id;
}

function getElementValue(sessionId, id) {
  var res = request('GET', '/session/' + sessionId + '/element/' + id + '/attribute/value');
  if (res.status < 200 || res.status >= 300) {
    return undefined;
  }
  return res.body && typeof res.body.value !== 'undefined' ? String(res.body.value) : undefined;
}

function globalValue(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('[wda-set-text] invalid variable name: ' + name);
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  return Object.prototype.hasOwnProperty.call(root, name) ? root[name] : undefined;
}

function resolveText() {
  if (typeof TEXT_VAR !== 'undefined' && TEXT_VAR) {
    var byName = globalValue(String(TEXT_VAR));
    if (typeof byName === 'undefined') {
      throw new Error('[wda-set-text] variable not found: ' + TEXT_VAR);
    }
    return String(byName);
  }

  if (typeof TEXT === 'undefined') {
    throw new Error('[wda-set-text] TEXT or TEXT_VAR is required');
  }

  var raw = String(TEXT);
  var match = raw.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!match) {
    return raw;
  }

  var resolved = globalValue(match[1]);
  if (typeof resolved === 'undefined') {
    throw new Error('[wda-set-text] unresolved placeholder: ' + raw);
  }
  return String(resolved);
}

if (!FIELD_ID) {
  throw new Error('[wda-set-text] FIELD_ID is required');
}

var text = resolveText();
if (!text && !ALLOW_EMPTY_TEXT) {
  throw new Error('[wda-set-text] refusing to set empty text for ' + FIELD_ID);
}

var sessionId = getActiveSessionId();
if (!sessionId) {
  throw new Error('[wda-set-text] active WDA session id missing');
}

var id = findElement(sessionId, FIELD_ID);
var current = getElementValue(sessionId, id);
var forceSet = typeof FORCE_SET !== 'undefined' && String(FORCE_SET) === '1';

if (current === text && !forceSet) {
  console.log('[wda-set-text] kept ' + FIELD_ID + ' (' + text.length + ' chars)');
} else {
  // Clear first so this remains safe when normal inputText worked and this
  // optional correction still runs.
  try {
    post('/session/' + sessionId + '/element/' + id + '/clear', {});
  } catch (err) {
    console.log('[wda-set-text] clear failed for ' + FIELD_ID + ': ' + err.message);
  }

  post('/session/' + sessionId + '/element/' + id + '/value', {
    text: text,
    value: text.split(''),
  });

  console.log('[wda-set-text] set ' + FIELD_ID + ' (' + text.length + ' chars)');
}
