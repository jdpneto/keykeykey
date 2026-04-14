import { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { parseTotpUri } from '@keykeykey/core/totp';
import { useTheme } from '@/lib/theme-provider';
import { TotpScanHandoff } from '@/lib/totp-scan-handoff';

export default function QrScanScreen() {
  const router = useRouter();
  const { theme: t } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // Guard against the `onBarcodeScanned` callback firing multiple times for a
  // single physical QR code before the modal has a chance to close.
  const handledRef = useRef(false);

  const handleScanned = useCallback(
    (data: string) => {
      if (handledRef.current) return;
      try {
        parseTotpUri(data);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Not a TOTP QR code';
        setError(msg);
        // Allow another attempt after a brief pause.
        setTimeout(() => setError(null), 1500);
        return;
      }
      handledRef.current = true;
      TotpScanHandoff.set(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    [router],
  );

  if (!permission) {
    // Still loading permissions.
    return <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
        <View style={styles.permissionHeader}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={[styles.cancelText, { color: t.colors.primary }]}>Cancel</Text>
          </Pressable>
        </View>
        <View style={styles.permissionBody}>
          <Ionicons name="qr-code-outline" size={48} color={t.colors.textSecondary} />
          <Text style={[styles.permissionTitle, { color: t.colors.text }]}>Camera access</Text>
          <Text style={[styles.permissionMsg, { color: t.colors.textSecondary }]}>
            KeyKeyKey needs camera access to scan 2FA QR codes. The camera is only used while this
            screen is open — nothing is recorded or sent anywhere.
          </Text>
          {permission.canAskAgain ? (
            <Pressable
              onPress={requestPermission}
              style={[styles.primaryBtn, { backgroundColor: t.colors.primary }]}
            >
              <Text style={styles.primaryBtnText}>Grant camera access</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => Linking.openSettings()}
              style={[styles.primaryBtn, { backgroundColor: t.colors.primary }]}
            >
              <Text style={styles.primaryBtnText}>Open settings</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(e) => handleScanned(e.data)}
      />

      {/* Scan frame overlay */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.frame, { borderColor: t.colors.primary }]} />
      </View>

      <SafeAreaView style={styles.cameraChrome} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityLabel="Close scanner"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.hint}>Align the QR code within the frame</Text>
          <View style={styles.closeBtn} />
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  permissionHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  cancelText: {
    fontSize: 16,
  },
  permissionBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  permissionMsg: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderRadius: 16,
  },
  cameraChrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 8,
  },
  errorBanner: {
    marginHorizontal: 24,
    marginBottom: 32,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(200, 40, 40, 0.9)',
    borderRadius: 10,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
});
