import React, { useCallback, useMemo, useRef } from 'react';
import { Alert, Animated, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';
import { ItemCard } from './ItemCard';
import type { VaultItem } from '@keykeykey/core';

const ACTION_WIDTH = 72;
const REVEAL_WIDTH = ACTION_WIDTH * 2; // edit + delete
// Match ItemCard's marginBottom so the underlay buttons align with the
// visible card and don't bleed into the inter-row gap.
const ROW_MARGIN_BOTTOM = 8;

type Props = {
  item: VaultItem;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
  testID?: string;
};

/**
 * Vault list row with two contextual gestures:
 *
 *  - **Long-press** (cross-platform): brings up an action sheet with Edit /
 *    Delete options. Delete requires a second confirmation alert.
 *  - **Swipe-left** (iOS only): reveals two icon buttons inset to the right
 *    edge of the row — Edit (primary) and Delete (danger). Tap-to-trigger;
 *    Delete still confirms before removing.
 *
 * Implementation uses RN's built-in PanResponder + Animated. This keeps the
 * change JS-only (no native rebuild) — fine for vault sizes typical for a
 * password manager. If swipe perf ever feels janky on long lists, swap to
 * `react-native-gesture-handler`'s Swipeable (would require a prebuild).
 */
export function SwipeableItemRow({ item, onPress, onEdit, onDelete, testID }: Props) {
  const { theme: t } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const swipeEnabled = Platform.OS === 'ios';

  const animateTo = useCallback(
    (x: number) => {
      isOpen.current = x !== 0;
      Animated.spring(translateX, {
        toValue: x,
        useNativeDriver: true,
        tension: 100,
        friction: 12,
      }).start();
    },
    [translateX],
  );

  const close = useCallback(() => animateTo(0), [animateTo]);
  const open = useCallback(() => animateTo(-REVEAL_WIDTH), [animateTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only intercept when the gesture is clearly horizontal — the
        // FlatList needs vertical pans to scroll. The 1.5x slope test gives
        // diagonal scrolls back to the list.
        onMoveShouldSetPanResponder: (_, g) =>
          swipeEnabled && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderGrant: () => {
          // Stop any in-flight spring so the user gets immediate control.
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          const startX = isOpen.current ? -REVEAL_WIDTH : 0;
          const next = startX + g.dx;
          // Clamp to [-REVEAL_WIDTH, 0]: no rightward overshoot past the
          // closed position; small left rubber-band would be nice but adds
          // complexity for little gain.
          translateX.setValue(Math.max(Math.min(next, 0), -REVEAL_WIDTH));
        },
        onPanResponderRelease: (_, g) => {
          const startX = isOpen.current ? -REVEAL_WIDTH : 0;
          const next = startX + g.dx;
          // Commit at past-midpoint OR when there's clear left velocity even
          // before midpoint (matches iOS's flick-to-open feel).
          if (next < -REVEAL_WIDTH / 2 || g.vx < -0.5) open();
          else close();
        },
        onPanResponderTerminate: close,
      }),
    [swipeEnabled, open, close, translateX],
  );

  const confirmDelete = useCallback(() => {
    Alert.alert('Delete Item', `Are you sure you want to delete "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel', onPress: close },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          close();
          onDelete();
        },
      },
    ]);
  }, [item.name, onDelete, close]);

  const showActionMenu = useCallback(() => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    Alert.alert(item.name, undefined, [
      {
        text: 'Edit',
        onPress: () => {
          close();
          onEdit();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: confirmDelete,
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [item.name, onEdit, close, confirmDelete]);

  const handleEditFromSwipe = useCallback(() => {
    close();
    onEdit();
  }, [close, onEdit]);

  return (
    <View style={styles.container}>
      {swipeEnabled && (
        <View style={styles.actions} pointerEvents="box-none">
          <Pressable
            testID={testID ? `${testID}-edit` : undefined}
            accessibilityLabel={`Edit ${item.name}`}
            accessibilityRole="button"
            onPress={handleEditFromSwipe}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: t.colors.primary,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="pencil" size={22} color={t.colors.background} />
          </Pressable>
          <Pressable
            testID={testID ? `${testID}-delete` : undefined}
            accessibilityLabel={`Delete ${item.name}`}
            accessibilityRole="button"
            onPress={confirmDelete}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: t.colors.danger,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="trash" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
      )}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...(swipeEnabled ? panResponder.panHandlers : {})}
      >
        <ItemCard item={item} onPress={onPress} onLongPress={showActionMenu} testID={testID} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  actions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: ROW_MARGIN_BOTTOM,
    flexDirection: 'row',
    width: REVEAL_WIDTH,
  },
  actionButton: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
