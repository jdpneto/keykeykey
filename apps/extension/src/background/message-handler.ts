/**
 * Background service worker message handler for KeyKeyKey browser extension.
 *
 * Thin shim: creates a HandlerContext and delegates every message to the
 * domain-specific handlers via the router.
 */

import type { BackgroundMessage } from '../lib/messages.js';
import { createHandlerContext } from './context.js';
import { routeMessage } from './router.js';

// ---------------------------------------------------------------------------
// Per-tab fillable credential allowlist (module-level singleton, shared across
// all handler instances — background/index.ts clears it on LOCK / URL change)
// ---------------------------------------------------------------------------

export const tabAllowlists = new Map<number, Set<string>>();

// ---------------------------------------------------------------------------
// Factory — preserves the existing `createMessageHandler()` API
// ---------------------------------------------------------------------------

export function createMessageHandler() {
  const ctx = createHandlerContext({ tabAllowlists });

  let initPromise: Promise<void> | null = ctx.init();

  return async function handleMessage(
    message: BackgroundMessage,
    sender?: unknown,
  ): Promise<unknown> {
    // Wait for init on first call
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    // Reset auto-lock timer on every message
    ctx.autoLock?.resetTimer();

    return routeMessage(message, ctx, sender);
  };
}
