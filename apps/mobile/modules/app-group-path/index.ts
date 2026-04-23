import { Platform } from 'react-native';

let AppGroupPath: {
  getContainerPath: (groupId: string) => string | null;
  getKeychainAccessGroup: () => string | null;
  saveBiometricDEK: (payload: string) => Promise<boolean>;
  loadBiometricDEK: () => Promise<string | null>;
  deleteBiometricDEK: () => Promise<boolean>;
  keychainDiagnostic: () => string;
} | null = null;

if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AppGroupPath = require('expo-modules-core').requireNativeModule('AppGroupPath');
  } catch {
    // Module not available (e.g., in tests or on Android)
  }
}

export function getAppGroupContainerPath(groupId: string): string | null {
  if (!AppGroupPath) return null;
  return AppGroupPath.getContainerPath(groupId);
}

export function getKeychainAccessGroup(): string | null {
  if (!AppGroupPath) return null;
  return AppGroupPath.getKeychainAccessGroup();
}

export function runKeychainDiagnostic(): string {
  if (!AppGroupPath) return 'AppGroupPath module not available';
  return AppGroupPath.keychainDiagnostic();
}

export async function saveBiometricDEKNative(payload: string): Promise<boolean> {
  if (!AppGroupPath) return false;
  return AppGroupPath.saveBiometricDEK(payload);
}

export async function loadBiometricDEKNative(): Promise<string | null> {
  if (!AppGroupPath) return null;
  return AppGroupPath.loadBiometricDEK();
}

export async function deleteBiometricDEKNative(): Promise<boolean> {
  if (!AppGroupPath) return false;
  return AppGroupPath.deleteBiometricDEK();
}
