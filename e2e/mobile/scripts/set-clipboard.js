// Push text onto the device clipboard so Maestro's paste command
// can land it in a secure-text-entry field where `inputText` fails.
//
// Maestro's runScript runs inside GraalJS on the HOST. It exposes an
// `http` helper and a `maestro` global. We use `maestro.copyText` if
// present; otherwise fall back to setting `output.clipboardText` and
// let the flow copy from a renderable element.

if (typeof maestro !== 'undefined' && typeof maestro.copyText === 'function') {
  maestro.copyText(TEXT);
  console.log('[set-clipboard] pushed ' + TEXT.length + ' chars via maestro.copyText');
} else {
  // Fallback: the flow should use `evalScript "maestro.copyText(...)"`
  // directly — this branch is informational.
  console.log('[set-clipboard] maestro.copyText unavailable; clipboard not set');
  output.FALLBACK_REQUIRED = 'true';
}
