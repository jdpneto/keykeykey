import { Platform } from 'react-native';

let AppGroupPath: { getContainerPath: (groupId: string) => string | null } | null = null;

if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AppGroupPath = require('expo-modules-core').requireNativeModule('AppGroupPath');
  } catch {
    // Module not available (e.g., in tests or on Android)
  }
}

/**
 * Get the filesystem path for an iOS App Group shared container.
 * Returns null on Android or if the module is not available.
 */
export function getAppGroupContainerPath(groupId: string): string | null {
  if (!AppGroupPath) return null;
  return AppGroupPath.getContainerPath(groupId);
}
