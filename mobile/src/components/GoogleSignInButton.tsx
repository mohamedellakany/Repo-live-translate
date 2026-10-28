import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from "react-native";
import { useI18n } from "@/i18n";
import { radius, spacing } from "@/theme";
import { GoogleLogo } from "./GoogleLogo";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** Whether this build has the client IDs needed for Google sign-in. */
export const googleSignInConfigured = !!WEB_CLIENT_ID && (Platform.OS !== "ios" || !!IOS_CLIENT_ID);

/**
 * Native (iOS/Android) Google sign-in. Produces a Google ID token that the server verifies.
 * The native module is loaded lazily so the app still runs in Expo Go (where it's unavailable).
 */
export function GoogleSignInButton({ onCredential, onError }: { onCredential: (idToken: string) => void; onError: (message: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const press = async () => {
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily so Expo Go (no native module) doesn't crash
      const mod = require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
      const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = mod;
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID });
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const res = await GoogleSignin.signIn();
        if (isSuccessResponse(res) && res.data.idToken) onCredential(res.data.idToken);
      } catch (err) {
        if (isErrorWithCode(err) && (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)) return;
        onError(t("auth.googleFailed"));
      }
    } catch {
      onError(t("auth.googleUnavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={press}
      disabled={busy}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator color="#1f1f1f" /> : <GoogleLogo />}
      <Text style={styles.text}>{t("auth.continueWithGoogle")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.lg,
  },
  text: { color: "#1f1f1f", fontSize: 16, fontWeight: "600" },
});
