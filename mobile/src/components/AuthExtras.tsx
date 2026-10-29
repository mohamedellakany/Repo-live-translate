import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n } from "@/i18n";
import { routeAfterAuth } from "@/lib/postAuth";
import { useServerConfig } from "@/lib/serverConfig";
import { makeStyles, spacing } from "@/theme";
import { GoogleSignInButton, googleSignInConfigured } from "./GoogleSignInButton";
import { Banner } from "./ui";

/** "Continue with Google" + divider, shown when both the app build and the server support it. */
export function GoogleAuthSection({ next }: { next?: string }) {
  const styles = useStyles();
  const { t } = useI18n();
  const { signInWithGoogle } = useAuth();
  const { features } = useServerConfig();
  const [error, setError] = useState<string | null>(null);
  if (!googleSignInConfigured || !features.googleSignIn) return null;

  const onCredential = async (idToken: string) => {
    setError(null);
    try {
      const res = await signInWithGoogle(idToken);
      if ("needsProfile" in res) {
        router.push({
          pathname: "/complete-profile",
          params: {
            signupToken: res.signupToken,
            email: res.profile.email,
            displayName: res.profile.displayName,
            suggestedUsername: res.profile.suggestedUsername,
            next: next ?? "",
          },
        });
      } else {
        routeAfterAuth(res.user, next);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      {error && <Banner tone="error" text={error} />}
      <GoogleSignInButton onCredential={onCredential} onError={setError} />
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>{t("common.or")}</Text>
        <View style={styles.line} />
      </View>
    </View>
  );
}

/** "By continuing you agree to our Terms and Privacy Policy" with tappable links. */
export function LegalNotice() {
  const styles = useStyles();
  const { t } = useI18n();
  const [before, rest = ""] = t("auth.agree").split("{terms}");
  const [middle, after = ""] = rest.split("{privacy}");
  return (
    <Text style={styles.legal}>
      {before}
      <Text style={styles.link} onPress={() => router.push("/terms")}>
        {t("auth.termsLink")}
      </Text>
      {middle}
      <Text style={styles.link} onPress={() => router.push("/privacy")}>
        {t("auth.privacyLink")}
      </Text>
      {after}
    </Text>
  );
}

const useStyles = makeStyles((colors) => ({
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  or: { color: colors.textDim, fontSize: 13 },
  legal: { color: colors.textDim, fontSize: 13, textAlign: "center", lineHeight: 19 },
  link: { color: colors.primary, fontWeight: "600" },
}));
