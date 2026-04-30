---
status: accepted
---

# Tauri command surface stays a flat `invoke_handler!` list

The desktop backend's `invoke_handler!` list in `apps/desktop/src-tauri/src/lib.rs`
is a flat enumeration of every `#[tauri::command]` in the project. Adding a new
stateful module today touches three places: the module file (writing the
commands), the setup closure (state init), and the handler list.

A future reviewer will be tempted to introduce a `TauriModule` trait + dispatcher
to consolidate this. Don't. `tauri::generate_handler!` is a compile-time macro
that requires every handler name to be statically present at the call site —
the dispatcher pattern would only solve the setup-closure half of the problem,
and at the price of an abstraction nobody else on the team uses.

When the command count exceeds ~50 or the `setup` closure crosses ~50 lines of
state plumbing, revisit by extracting per-module `setup(app)` functions
(plain functions, not a trait) so each module owns its init in its own file.
The handler list still has to stay flat.
