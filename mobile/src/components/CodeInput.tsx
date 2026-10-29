import { useRef } from "react";
import { Pressable, Text, TextInput, View, type TextInputInstance } from "react-native";
import { useI18n } from "@/i18n";
import { makeStyles, radius, spacing } from "@/theme";

/** 6-digit one-time code input. Calls onComplete when all digits are entered (incl. paste / SMS autofill). */
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
  const { isRTL } = useI18n();
  const ref = useRef<TextInputInstance>(null);
  const digits = value.split("");
  return (
    <View style={{ gap: spacing.sm }}>
      {/* Digits always read left-to-right, even in the Arabic (RTL) layout. */}
      <Pressable
        onPress={() => ref.current?.focus()}
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
      {/* One real input sits over the cells so paste and one-time-code autofill work everywhere. */}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, "").slice(0, length);
          onChange(v);
          if (v.length === length) onComplete?.(v);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus
        style={styles.hidden}
        accessibilityLabel={label}
      />
      {error && <Text style={styles.error}>{error}</Text>}
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
  hidden: { position: "absolute", top: 0, left: 0, right: 0, height: 58, opacity: 0.01, color: "transparent" },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
}));
