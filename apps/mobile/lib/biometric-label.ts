import { Platform } from 'react-native';

/** User-facing name of the platform's biometric unlock (Apple's terms on iOS, Android's elsewhere). */
export const BIOMETRIC_LABEL =
  Platform.OS === 'ios' ? 'Face ID / Touch ID' : 'Fingerprint / Face Unlock';
