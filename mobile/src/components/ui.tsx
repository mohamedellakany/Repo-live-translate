import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Switch,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "@/i18n";
import { makeStyles, maxContentWidth, radius, spacing, useTheme, type ThemeColors } from "@/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/* ------------------------------- Layout ---------------------------------- */

export function Screen({
  children,
  scroll = false,
  header,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  header?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const inner = <View style={[styles.content, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {inner}
          </ScrollView>
        ) : (
          inner
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AppHeader({ title, back = true, right }: { title?: string; back?: boolean; right?: ReactNode }) {
  const styles = useStyles();
  const { t, isRTL } = useI18n();
  return (
    <View style={styles.headerOuter}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {back && (
            <IconButton
              icon={isRTL ? "chevron-forward" : "chevron-back"}
              label={t("common.back")}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            />
          )}
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.headerSide, { alignItems: "flex-end" }]}>{right}</View>
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ------------------------------- Controls -------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "live";

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  size = "md",
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const v = buttonVariants(colors)[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        size === "lg" && styles.buttonLg,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border },
        isDisabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={size === "lg" ? 22 : 18} color={v.fg} />}
          <Text style={[styles.buttonText, size === "lg" && { fontSize: 17 }, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const buttonVariants = (colors: ThemeColors): Record<ButtonVariant, { bg: string; pressed: string; fg: string; border: string }> => ({
  primary: { bg: colors.primary, pressed: colors.primaryPressed, fg: "#fff", border: colors.primary },
  secondary: { bg: colors.surfaceAlt, pressed: colors.border, fg: colors.text, border: colors.border },
  ghost: { bg: "transparent", pressed: colors.surfaceAlt, fg: colors.text, border: "transparent" },
  danger: { bg: "transparent", pressed: colors.dangerPressed, fg: colors.danger, border: colors.danger },
  live: { bg: colors.live, pressed: colors.livePressed, fg: "#fff", border: colors.live },
});

export function IconButton({
  icon,
  label,
  onPress,
  active,
  color,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  active?: boolean;
  color?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, (pressed || active) && { backgroundColor: colors.surfaceAlt }]}
    >
      <Ionicons name={icon} size={22} color={color ?? (active ? colors.primary : colors.text)} />
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  prefix,
  hint,
  style,
  ...props
}: TextInputProps & { label?: string; error?: string | null; prefix?: string; hint?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrap, error ? { borderColor: colors.danger } : null]}>
        {prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput placeholderTextColor={colors.textDim} style={[styles.input, style]} accessibilityLabel={label} {...props} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------- Feedback -------------------------------- */

export function Banner({ tone = "info", text, icon }: { tone?: "info" | "warning" | "error"; text: string; icon?: IconName }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const c = tone === "error" ? colors.danger : tone === "warning" ? colors.warning : colors.primary;
  const defaultIcon: IconName = tone === "info" ? "information-circle" : "warning";
  return (
    <View style={[styles.banner, { borderColor: c, backgroundColor: `${c}1A` }]} accessibilityRole="alert">
      <Ionicons name={icon ?? defaultIcon} size={18} color={c} />
      <Text style={[styles.bannerText]}>{text}</Text>
    </View>
  );
}

export function LiveBadge({ state }: { state: "live" | "offline" | "reconnecting" | "paused" }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const color = { live: colors.live, reconnecting: colors.warning, paused: colors.warning, offline: colors.textDim }[state];
  const label = t(`badge.${state}`);
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Chip({ icon, text }: { icon?: IconName; text: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.chip}>
      {icon && <Ionicons name={icon} size={14} color={colors.textMuted} />}
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  content: { flex: 1, width: "100%", maxWidth: maxContentWidth, alignSelf: "center", padding: spacing.lg, gap: spacing.lg },
  headerOuter: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  header: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: maxContentWidth,
    alignSelf: "center",
    paddingHorizontal: spacing.sm,
    height: 52,
  },
  headerSide: { width: 96, flexDirection: "row", gap: 4 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 17, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonLg: { minHeight: 58, borderRadius: radius.lg },
  buttonText: { fontSize: 16, fontWeight: "600" },
  iconButton: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  prefix: { color: colors.textMuted, fontSize: 16, marginRight: 2 },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 13, outlineStyle: "none" } as any,
  error: { color: colors.danger, fontSize: 13 },
  hint: { color: colors.textDim, fontSize: 13 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerText: { color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "500" },
}));

/* ------------------------------ Form rows -------------------------------- */

export function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  const rowStyles = useRowStyles();
  return (
    <View style={rowStyles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={rowStyles.label}>{label}</Text>
        {hint && <Text style={rowStyles.hint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor="#fff"
        accessibilityLabel={label}
      />
    </View>
  );
}

/** A tappable row showing the current value of a setting; opens a picker. */
export function SelectRow({ label, value, hint, onPress, icon }: { label: string; value: string; hint?: string; onPress: () => void; icon?: IconName }) {
  const { colors } = useTheme();
  const rowStyles = useRowStyles();
  const { isRTL } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [rowStyles.row, pressed && { opacity: 0.7 }]}
    >
      {icon && <Ionicons name={icon} size={20} color={colors.textMuted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={rowStyles.label}>{label}</Text>
        {hint && <Text style={rowStyles.hint}>{hint}</Text>}
      </View>
      <Text style={rowStyles.value} numberOfLines={1}>
        {value}
      </Text>
      <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.textDim} />
    </Pressable>
  );
}

/* --------------------------------- Sheets -------------------------------- */

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const sheetStyles = useSheetStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={sheetStyles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={sheetStyles.sheet} onPress={(e) => e.stopPropagation()}>
          {title && <Text style={sheetStyles.title}>{title}</Text>}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function OptionSheet<T extends string>({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: Option<T>[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const { colors } = useTheme();
  const sheetStyles = useSheetStyles();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 460 }}>
        {options.map((o) => {
          const active = o.value === selected;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => {
                onSelect(o.value);
                onClose();
              }}
              style={({ pressed }) => [sheetStyles.option, (pressed || active) && { backgroundColor: colors.surfaceAlt }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[sheetStyles.optionLabel, active && { color: colors.primary }]}>{o.label}</Text>
                {o.description && <Text style={sheetStyles.optionDesc}>{o.description}</Text>}
              </View>
              {active && <Ionicons name="checkmark" size={20} color={colors.primary} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const useRowStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  label: { color: colors.text, fontSize: 15, fontWeight: "600" },
  hint: { color: colors.textDim, fontSize: 13 },
  value: { color: colors.textMuted, fontSize: 15, maxWidth: "45%" },
}));

const useSheetStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%",
    maxWidth: maxContentWidth,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  optionLabel: { color: colors.text, fontSize: 16, fontWeight: "600" },
  optionDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
}));
