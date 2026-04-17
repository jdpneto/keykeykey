import React from 'react';
import { render } from '@testing-library/react-native';
import { QuickUnlockPrompt } from '../../components/QuickUnlockPrompt';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@/lib/vault-context', () => ({
  useVault: () => ({
    biometricAvailable: true,
    enableBiometric: jest.fn(),
    enablePin: jest.fn(),
    dismissQuickUnlockPrompt: jest.fn(),
  }),
}));

jest.mock('@keykeykey/core/pin', () => ({
  validatePin: () => ({ valid: true }),
}));

describe('QuickUnlockPrompt', () => {
  it('renders biometric button with hardcoded testID quick-unlock-biometric', () => {
    const { getByTestId } = render(<QuickUnlockPrompt onDismiss={() => {}} />);
    expect(getByTestId('quick-unlock-biometric')).toBeTruthy();
  });
});
