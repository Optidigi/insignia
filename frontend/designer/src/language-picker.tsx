import { LANGUAGE_OPTIONS, parseLanguagePreference, type SupportedLanguage } from "@insignia/ui-localization/core";
import { useLocale } from "./customer-locale";
import { IconChevronDown, IconGlobe } from "./legacy-icons";

interface CustomerLanguagePickerProps {
  preference: SupportedLanguage | null;
  failure: boolean;
  onPreferenceChange: (preference: SupportedLanguage | null) => void;
}

export function CustomerLanguagePicker({
  preference,
  failure,
  onPreferenceChange,
}: CustomerLanguagePickerProps) {
  const { t, lang, activeLanguage } = useLocale();
  const activeLanguageCode = parseLanguagePreference(lang.split("-")[0]) ??
    parseLanguagePreference(activeLanguage) ?? "en";
  const activeOption = LANGUAGE_OPTIONS.find((option) => option.value === activeLanguageCode) ??
    LANGUAGE_OPTIONS[0];
  const selectedOption = preference === null
    ? activeOption
    : LANGUAGE_OPTIONS.find((option) => option.value === preference) ?? activeOption;

  return (
    <>
      <label className="language-picker" title={t("customer:language.label")}>
        <IconGlobe className="language-picker-icon" size={19} />
        <span className="language-picker-value" lang={preference ?? lang}>
          {selectedOption.label}
        </span>
        <IconChevronDown className="language-picker-chevron" size={15} />
        <select
          id="customer-language"
          aria-label={t("customer:language.label")}
          value={preference ?? ""}
          onChange={(event) => {
            onPreferenceChange(parseLanguagePreference(event.currentTarget.value));
          }}
        >
          <option value="" lang={lang}>{t("customer:language.automatic")}</option>
          {LANGUAGE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value} lang={value}>{label}</option>
          ))}
        </select>
      </label>
      {failure && (
        <span className="language-picker-error" role="status" aria-live="polite">
          {t("customer:language.failure")}
        </span>
      )}
    </>
  );
}
