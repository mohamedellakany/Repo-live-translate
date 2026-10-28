import { LegalPage } from "@/components/LegalPage";
import { getPrivacy } from "@/content/legal";
import { useI18n } from "@/i18n";

export default function Privacy() {
  const { t, lang } = useI18n();
  return <LegalPage title={t("legal.privacyTitle")} sections={getPrivacy(lang)} />;
}
