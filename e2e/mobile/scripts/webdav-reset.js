// Clear the WebDAV remote via the clear-data endpoint, so sync flows
// start against a known-empty server.
//
// Runs inside Maestro's GraalJS engine. Environment variables are
// injected via the `runScript: { env: { ... } }` block in the caller.
// No fetch/Buffer/top-level await in GraalJS — use Maestro's built-in
// `http.post` helper and a hand-rolled base64 encoder.

function b64encode(input) {
  var CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var output = '';
  var i = 0;
  while (i < input.length) {
    var b1 = input.charCodeAt(i++);
    var b2 = i < input.length ? input.charCodeAt(i++) : NaN;
    var b3 = i < input.length ? input.charCodeAt(i++) : NaN;
    var e1 = b1 >> 2;
    var e2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
    var e3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
    var e4 = isNaN(b3) ? 64 : b3 & 63;
    output +=
      CHARS.charAt(e1) +
      CHARS.charAt(e2) +
      (e3 === 64 ? '=' : CHARS.charAt(e3)) +
      (e4 === 64 ? '=' : CHARS.charAt(e4));
  }
  return output;
}

if (!WEBDAV_URL || !WEBDAV_USER || !WEBDAV_PASS) {
  console.log('[webdav-reset] skipping — KKK_WEBDAV_* env vars not passed through');
  output.skipped = 'true';
} else {
  var clearUrl =
    (typeof WEBDAV_CLEAR_URL !== 'undefined' && WEBDAV_CLEAR_URL) ||
    'https://davidneto.eu/api/webdav/clear-data';

  var auth = 'Basic ' + b64encode(WEBDAV_USER + ':' + WEBDAV_PASS);

  // OkHttp requires a body on POST; pass an empty string.
  var res = http.post(clearUrl, {
    headers: { Authorization: auth },
    body: '',
  });

  var status = res && res.status;
  console.log('[webdav-reset] clear-data status ' + status);
  // Fail loudly on non-2xx. A silent 401/500 here leaves a dirty
  // remote and surfaces downstream as a mystery "Incompatible Remote
  // Vault" dialog 60 seconds later. Much better to fail the flow at
  // the reset itself.
  if (typeof status !== 'number' || status < 200 || status >= 300) {
    throw new Error('[webdav-reset] clear-data returned status ' + status);
  }
  output.skipped = 'false';
}
