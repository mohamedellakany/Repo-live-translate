import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputInstance } from "react-native";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n";
import { makeStyles, radius, spacing } from "@/theme";

/** Keep only digits, converting Arabic-Indic ones (٠-٩, ۰-۹) so pasted codes work in any language. */
const onlyDigits = (t: string) =>
  t
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");

/**
 * 6-digit one-time code input. Calls onComplete when all digits are entered: typing, one-time-code
 * autofill, keyboard paste, long-pressing the boxes, or the "Paste code" button.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  error,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  error?: string | null;
  label?: string;
}) {
  const styles = useStyles();
  const { t, isRTL } = useI18n();
  const ref = useRef<TextInputInstance>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const digits = value.split("");

  const update = (text: string) => {
    const v = onlyDigits(text).slice(0, length);
    setPasteError(null);
    onChange(v);
    if (v.length === length) onComplete?.(v);
  };

  /** Fill the code from the clipboard (long-press or the Paste button). */
  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => "");
    // Prefer an exact standalone code (e.g. "Your code is 123456"), else any digits.
    const match = onlyDigits(text).length === length ? onlyDigits(text) : (/\b\d{6}\b/.exec(text)?.[0] ?? "");
    if (match.length !== length) return setPasteError(t("code.noCode"));
    update(match);
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {/* Digits always read left-to-right, even in the Arabic (RTL) layout. */}
      <Pressable
        onPress={() => ref.current?.focus()}
        onLongPress={paste}
        delayLongPress={350}
        style={[styles.row, { flexDirection: isRTL ? "row-reverse" : "row" }]}
        accessibilityLabel={label}
      >
        {Array.from({ length }).map((_, i) => {
          const focused = i === Math.min(value.length, length - 1);
          return (
            <View key={i} style={[styles.cell, focused && styles.cellFocused, !!error && styles.cellError]}>
              <Text style={styles.digit}>{digits[i] ?? ""}</Text>
            </View>
          );
        })}
      </Pressable>
      {/* The real input stays focused for typing and one-time-code autofill, but doesn't take touches:
          long-pressing an invisible input doesn't show a paste menu on many phones, so the boxes handle it. */}
      <View pointerEvents="none" style={styles.hidden}>
        <TextInput
          ref={ref}
          value={value}
          onChangeText={update}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
          style={styles.hiddenInput}
          accessibilityLabel={label}
        />
      </View>
      {(error || pasteError) && <Text style={styles.error}>{error ?? pasteError}</Text>}
      <Button title={t("code.paste")} icon="clipboard-outline" variant="ghost" onPress={paste} />
      <Text style={styles.hint}>{t("code.pasteHint")}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: spacing.sm, justifyContent: "center" },
  cell: {
    width: 48,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cellFocused: { borderColor: colors.primary },
  cellError: { borderColor: colors.danger },
  digit: { color: colors.text, fontSize: 24, fontWeight: "700" },
  hidden: { position: "absolute", top: 0, left: 0, right: 0, height: 58, opacity: 0.01 },
  hiddenInput: { flex: 1, color: "transparent" },
  hint: { color: colors.textDim, fontSize: 12, textAlign: "center" },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
}));
