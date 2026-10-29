import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useI18n } from "@/i18n";
import { listenUrl } from "@/lib/config";
import { makeStyles, radius, spacing } from "@/theme";
import { Button, Card } from "./ui";

export function ShareCard({ username, displayName, pin }: { username: string; displayName: string; pin?: string | null }) {
  const styles = useStyles();
  const { t } = useI18n();
  const [copied, setCopied] = useState<"id" | "link" | null>(null);
  const url = listenUrl(username);

  const copy = async (what: "id" | "link") => {
    await Clipboard.setStringAsync(what === "id" ? username : url);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const share = async () => {
    const message = t("shareCard.message", { name: displayName, url, username }) + (pin ? `\n${t("shareCard.pinNote", { pin })}` : "");
    if (Platform.OS === "web") {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) return nav.share({ title: t("common.appName"), text: message, url }).catch(() => {});
      return copy("link");
    }
    await Share.share({ message });
  };

  return (
    <Card style={{ alignItems: "center" }}>
      <Text style={styles.label}>{t("shareCard.label")}</Text>
      <Text style={styles.id} selectable>
        @{username}
      </Text>
      <View style={styles.qr}>
        <QRCode value={url} size={180} backgroundColor="#fff" color="#0B1020" />
      </View>
      {pin ? <Text style={styles.pin}>{t("shareCard.pinNote", { pin })}</Text> : null}
      <Text style={styles.hint}>{t("shareCard.hint")}</Text>
      <View style={styles.row}>
        <Button
          title={copied === "id" ? t("common.copied") : t("shareCard.copyId")}
          icon="copy-outline"
          variant="secondary"
          onPress={() => copy("id")}
          style={{ flex: 1 }}
        />
        <Button title={t("shareCard.shareLink")} icon="share-outline" variant="secondary" onPress={share} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { color: colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 1.2 },
  id: { color: colors.text, fontSize: 28, fontWeight: "700", writingDirection: "ltr" },
  qr: { padding: spacing.md, backgroundColor: "#fff", borderRadius: radius.md },
  pin: { color: colors.warning, fontSize: 15, fontWeight: "700" },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  row: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
}));
