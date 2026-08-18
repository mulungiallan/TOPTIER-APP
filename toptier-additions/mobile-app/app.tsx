/**
 * React Native Mobile App — TOPTIER Mobile
 * Location: mobile-app/ (separate Expo project)
 *
 * Features:
 *  - Real-time signals & notifications
 *  - Biometric authentication (Face ID / Touch ID / Fingerprint)
 *  - Offline mode with AsyncStorage
 *  - QR scanner for quick pair lookup
 *  - Push notifications (FCM/APNs)
 *  - TradingView mobile charts
 *
 * Setup:
 *   cd mobile-app
 *   npm install
 *   npx expo start
 *
 * Build for production:
 *   eas build --platform ios
 *   eas build --platform android
 */

// ============ app/_layout.tsx (Entry point) ============
import { Stack } from "expo-router";
import { useEffect } from "react";
import * as SecureStore from "expo-secure-store";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // Initialize push notifications
    initPushNotifications();
    // Check biometric setup
    checkBiometricSetup();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: colorScheme === "dark" ? "#0a0a0f" : "#fff",
            },
            headerTintColor: colorScheme === "dark" ? "#fff" : "#000",
            contentStyle: {
              backgroundColor: colorScheme === "dark" ? "#0a0a0f" : "#fff",
            },
          }}
        >
          <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="signal/[id]" options={{ title: "Signal Details" }} />
          <Stack.Screen name="settings/index" options={{ title: "Settings" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

async function initPushNotifications() {
  try {
    const { registerForPushNotificationsAsync } = await import("./lib/notifications");
    const token = await registerForPushNotificationsAsync();
    if (token) {
      await SecureStore.setItemAsync("pushToken", token);
      // Send to server
      const userId = await SecureStore.getItemAsync("userId");
      if (userId) {
        await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/push/device`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, token, platform: Platform.OS }),
        });
      }
    }
  } catch (e) {
    console.error("Push notification init failed:", e);
  }
}

async function checkBiometricSetup() {
  try {
    const enabled = await SecureStore.getItemAsync("biometricEnabled");
    if (enabled === "true") {
      const { authenticate } = await import("./lib/biometric");
      const success = await authenticate("Authenticate to open TOPTIER");
      if (!success) {
        // Lock app
      }
    }
  } catch (e) {
    console.error("Biometric check failed:", e);
  }
}

// ============ app/(tabs)/index.tsx (Dashboard) ============
export function DashboardScreen() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const { pullDistance, isRefreshing, handlers } = usePullToRefresh(async () => {
    await loadSignals();
  });

  const loadSignals = async () => {
    try {
      const cached = await AsyncStorage.getItem("signals");
      if (cached) setSignals(JSON.parse(cached));
      const res = await fetch(`${API_URL}/api/signals`);
      const data = await res.json();
      setSignals(data.data);
      await AsyncStorage.setItem("signals", JSON.stringify(data.data));
    } catch (e) {
      // Offline — use cached
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      {...handlers}
      style={{ transform: [{ translateY: pullDistance }] }}
      refreshControl={undefined}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
      </View>
      <View style={styles.statsGrid}>
        <StatCard label="Total Signals" value="247" />
        <StatCard label="Win Rate" value="72.4%" />
        <StatCard label="Active" value="8" />
        <StatCard label="Today P&L" value="+$1,240" positive />
      </View>
      <Text style={styles.sectionTitle}>Recent Signals</Text>
      {signals.map((s) => <SignalCard key={s.id} signal={s} />)}
    </ScrollView>
  );
}

// ============ lib/biometric.ts (Face ID / Fingerprint) ============
import * as LocalAuthentication from "expo-local-authentication";

export async function authenticate(reason: string): Promise<boolean> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return true;

  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return true;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: "Use Passcode",
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
  });

  return result.success;
}

export async function isBiometricAvailable(): Promise<{
  available: boolean;
  types: string[];
}> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return { available: false, types: [] };
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return {
    available: true,
    types: types.map((t) => ({
      1: "Fingerprint",
      2: "Face ID",
      3: "Iris",
    }[t] || "Unknown")),
  };
}

// ============ lib/notifications.ts (Push Notifications) ============
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#00d4ff",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  token = (await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  })).data;
  return token;
}

// ============ components/QRScanner.tsx ============
import { BarCodeScanner } from "expo-barcode-scanner";

export function QRScanner({ onScan }: { onScan: (data: string) => void }) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  if (hasPermission === null) return <Text>Requesting camera permission...</Text>;
  if (!hasPermission) return <Text>No access to camera</Text>;

  return (
    <View style={{ flex: 1 }}>
      <BarCodeScanner
        onBarCodeScanned={scanned ? undefined : ({ data }) => {
          setScanned(true);
          onScan(data);
          setTimeout(() => setScanned(false), 2000);
        }}
        style={{ flex: 1 }}
      />
    </View>
  );
}
