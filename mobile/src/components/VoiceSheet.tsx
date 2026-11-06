import * as Speech from "expo-speech";
import { Text } from "react-native";
import { OptionSheet, Sheet } from "@/components/ui";
import { LANGUAGES } from "@/constants/languages";
import { useI18n } from "@/i18n";
import { AUTO_VOICE, voiceGender, voiceLabel, type useVoice } from "@/lib/voices";
import { useTheme } from "@/theme";

/** Picker for the read-aloud voice of one language. Choosing a voice plays a short sample. */
export function VoiceSheet({
  visible,
  onClose,
  lang,
  voice,
}: {
  visible: boolean;
  onClose: () => void;
  lang: string;
  voice: ReturnType<typeof useVoice>;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const language = LANGUAGES[lang];

  if (!voice.voices.length) {
    return (
      <Sheet visible={visible} onClose={onClose} title={t("voice.title")}>
        <Text style={{ color: colors.textMuted, fontSize: 15, lineHeight: 22 }}>{t("voice.none")}</Text>
      </Sheet>
    );
  }

  const options = [
    {
      value: AUTO_VOICE,
      label: t("voice.auto"),
      description: voice.auto ? voiceLabel(voice.auto) : t("voice.autoNone"),
    },
    ...[...voice.voices]
      // Male voices first, then the rest alphabetically.
      .sort((a, b) => voiceGender(b) - voiceGender(a) || voiceLabel(a).localeCompare(voiceLabel(b)))
      .map((v) => ({
        value: v.identifier,
        label: voiceLabel(v),
        description: [voiceGender(v) === 1 ? t("voice.male") : null, v.language].filter(Boolean).join(" · "),
      })),
  ];

  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title={t("voice.title")}
      options={options}
      selected={voice.choice}
      onSelect={(id) => {
        void voice.setChoice(id);
        const sampleVoice = id === AUTO_VOICE ? voice.auto?.identifier : id;
        Speech.stop();
        Speech.speak(language?.nativeName ?? lang, { language: language?.ttsLocale, voice: sampleVoice });
      }}
    />
  );
}
