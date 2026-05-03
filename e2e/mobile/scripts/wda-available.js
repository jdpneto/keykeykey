// Detect whether the DeviceLab/WebDriverAgent endpoint used by wda-set-text.js
// is reachable for this run. This lets flows use WDA-only text injection on
// physical iPhones while preserving normal Maestro inputText on other targets.

try {
  var res = http.get('http://127.0.0.1:8418/status', {
    headers: { 'Content-Type': 'application/json' },
  });
  output.wdaAvailable = !!(res && res.status >= 200 && res.status < 500);
} catch (_err) {
  output.wdaAvailable = false;
}

console.log('[wda-available] ' + output.wdaAvailable);
