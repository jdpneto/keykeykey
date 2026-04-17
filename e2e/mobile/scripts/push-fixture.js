// Push a CSV fixture into the Android emulator's Downloads folder
// so the document picker can find it. Not invoked directly from
// Maestro's runScript — runScript can't shell out. Called from
// the runner wrapper (scripts/run-mobile-e2e.sh) before `maestro test`.
//
// This script is kept alongside the flows for documentation; the
// actual push happens in shell via `adb push` inside the runner.
