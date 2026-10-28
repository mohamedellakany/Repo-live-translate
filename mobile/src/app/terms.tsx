import { LegalPage } from "@/components/LegalPage";
import { getTerms } from "@/content/legal";
import { useI18n } from "@/i18n";

export default function Terms() {
  const { t, lang } = useI18n();
  return <LegalPage title={t("legal.termsTitle")} sections={getTerms(lang)} />;
}
