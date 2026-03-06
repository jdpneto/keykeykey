// Apply crypto polyfill BEFORE any modules load (must be require, not import)
const ExpoCrypto = require('expo-crypto');
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = ExpoCrypto.getRandomValues;
}

// Now load the app
require('expo-router/entry');
