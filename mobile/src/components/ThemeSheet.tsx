import { OptionSheet } from "@/components/ui";
import { useI18n } from "@/i18n";
import { THEME_PREFERENCES, useTheme } from "@/theme";

/** Picker for the app theme: follow the device, light or dark. */
export function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title={t("theme.title")}
      options={THEME_PREFERENCES.map((p) => ({ value: p, label: t(`theme.${p}`) }))}
      selected={preference}
      onSelect={setPreference}
    />
  );
}
