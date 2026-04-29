export type { BiometricAdapter, BiometricResult } from './biometric-adapter.js';
export type { OSBiometricStore, LoadBytesResult } from './os-biometric-store.js';
export { createBiometricAdapter } from './create-biometric-adapter.js';
export { MAX_DEK_AGE_MS, encodeDEKPayload, decodeDEKPayload, isExpired } from './dek-payload.js';
