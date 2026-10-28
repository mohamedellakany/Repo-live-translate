import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/auth/AuthProvider";
import { I18nProvider } from "@/i18n";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: "slide_from_right",
            }}
          />
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
