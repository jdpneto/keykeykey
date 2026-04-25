import React from 'react';
import { Alert, Platform } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import type { VaultItem } from '@keykeykey/core';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  // Replace Animated.spring with a synchronous no-op so the snap-back/snap-
  // open animations don't fire after the test unmounts (which produces noisy
  // act() warnings about state updates outside act()). The button-press
  // logic doesn't depend on the animation actually completing.
  RN.Animated.spring = (
    value: { setValue: (v: number) => void },
    { toValue }: { toValue: number },
  ) => ({
    start: (cb?: (info: { finished: boolean }) => void) => {
      value.setValue(toValue);
      cb?.({ finished: true });
    },
    stop: () => {},
    reset: () => {},
  });
  return RN;
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

const credential: VaultItem = {
  id: 'cred-1',
  type: 'credential',
  name: 'Gmail',
  username: 'user@gmail.com',
  password: 'secret123',
  tags: [],
  favorite: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
} as VaultItem;

// Helper: invoke the button at index `idx` of the most recent Alert.alert
// call. RN's Alert.alert is mocked by jest-expo so we drive it through the
// mock. Index 0 = Edit, 1 = Delete, 2 = Cancel for the action menu.
function pressAlertButton(alertSpy: jest.SpyInstance, idx: number) {
  const lastCall = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = lastCall?.[2] as Array<{ text: string; onPress?: () => void }> | undefined;
  buttons?.[idx]?.onPress?.();
}

describe('SwipeableItemRow', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  describe('long-press menu (cross-platform)', () => {
    it('opens an action menu titled with the item name on long-press', () => {
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-1"
          item={credential}
          onPress={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
      );
      fireEvent(getByTestId('vault-item-1'), 'longPress');
      expect(alertSpy).toHaveBeenCalledTimes(1);
      // First arg = title; subsequent calls add the confirm dialog.
      expect(alertSpy.mock.calls[0]![0]).toBe('Gmail');
    });

    it('Edit menu choice fires onEdit', () => {
      const onEdit = jest.fn();
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-1"
          item={credential}
          onPress={() => {}}
          onEdit={onEdit}
          onDelete={() => {}}
        />,
      );
      fireEvent(getByTestId('vault-item-1'), 'longPress');
      pressAlertButton(alertSpy, 0); // Edit
      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('Delete menu choice opens a destructive confirmation; only confirm fires onDelete', () => {
      const onDelete = jest.fn();
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-1"
          item={credential}
          onPress={() => {}}
          onEdit={() => {}}
          onDelete={onDelete}
        />,
      );
      fireEvent(getByTestId('vault-item-1'), 'longPress');
      pressAlertButton(alertSpy, 1); // Delete in action menu

      // Now a confirmation alert is shown.
      expect(alertSpy).toHaveBeenCalledTimes(2);
      const confirmCall = alertSpy.mock.calls[1]!;
      expect(confirmCall[0]).toBe('Delete Item');
      expect(String(confirmCall[1])).toContain('Gmail');

      // Cancel does NOT delete.
      pressAlertButton(alertSpy, 0); // Cancel in confirmation
      expect(onDelete).not.toHaveBeenCalled();

      // Re-open and confirm Delete.
      fireEvent(getByTestId('vault-item-1'), 'longPress');
      pressAlertButton(alertSpy, 1); // Delete in action menu (3rd alertSpy call)
      pressAlertButton(alertSpy, 1); // Delete in confirmation (4th alertSpy call)
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('iOS swipe actions', () => {
    const realOS = Platform.OS;

    beforeAll(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    });
    afterAll(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS });
    });

    it('renders edit and delete underlay buttons on iOS', () => {
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-2"
          item={credential}
          onPress={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
      );
      expect(getByTestId('vault-item-2-edit')).toBeTruthy();
      expect(getByTestId('vault-item-2-delete')).toBeTruthy();
    });

    it('tapping the swipe Edit button fires onEdit', () => {
      const onEdit = jest.fn();
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-2"
          item={credential}
          onPress={() => {}}
          onEdit={onEdit}
          onDelete={() => {}}
        />,
      );
      fireEvent.press(getByTestId('vault-item-2-edit'));
      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('tapping the swipe Delete button opens confirmation; confirm fires onDelete', () => {
      const onDelete = jest.fn();
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-2"
          item={credential}
          onPress={() => {}}
          onEdit={() => {}}
          onDelete={onDelete}
        />,
      );
      fireEvent.press(getByTestId('vault-item-2-delete'));
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy.mock.calls[0]![0]).toBe('Delete Item');
      pressAlertButton(alertSpy, 1); // Delete confirmation
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('Android (no swipe underlay)', () => {
    const realOS = Platform.OS;

    beforeAll(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    });
    afterAll(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: realOS });
    });

    it('does NOT render swipe underlay buttons on Android', () => {
      const { queryByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-3"
          item={credential}
          onPress={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />,
      );
      expect(queryByTestId('vault-item-3-edit')).toBeNull();
      expect(queryByTestId('vault-item-3-delete')).toBeNull();
    });

    it('long-press still opens the action menu on Android', () => {
      const onEdit = jest.fn();
      const { getByTestId } = render(
        <SwipeableItemRow
          testID="vault-item-3"
          item={credential}
          onPress={() => {}}
          onEdit={onEdit}
          onDelete={() => {}}
        />,
      );
      fireEvent(getByTestId('vault-item-3'), 'longPress');
      pressAlertButton(alertSpy, 0); // Edit
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  });
});
