import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { selectedLanguagePreference, type LanguagePreference } from "@insignia/ui-localization/core";
import { createCustomerLocaleController, LocaleProvider, useLocale } from "../../src/customer-locale";
import { useCustomerLanguage } from "../../src/use-customer-language";
import { CustomerLanguagePicker } from "../../src/language-picker";
import "../../src/style.css";
import "../../src/theme.css";

const pending: Array<() => void> = [];
const preparations: string[] = [];
const factory: typeof createCustomerLocaleController = (locale, options) => createCustomerLocaleController(locale, {
  ...options,
  prepareLocale: async (resolved) => {
    preparations.push(resolved.requestedLocale ?? "");
    if (resolved.activeLanguage === "de") await new Promise<void>((resolve) => pending.push(resolve));
  },
});
interface ProbeApi {
  releaseGerman(): void;
  preparations(): string[];
  changes(): LanguagePreference[];
  setHostLocale(value: string): void;
}
function ActiveLocale() {
  const locale = useLocale();
  return <output id="active-locale" data-format-locale={locale.formatLocale}>{locale.lang}</output>;
}
function Probe() {
  const [hostLocale, setHostLocale] = useState("en");
  const changes = useRef<LanguagePreference[]>([]);
  const language = useCustomerLanguage({ hostLocale, onPreferenceChange: (value) => changes.current.push(value) }, factory);
  useLayoutEffect(() => {
    const owner = window as Window & { __languageProbe?: ProbeApi };
    owner.__languageProbe = {
      releaseGerman: () => { for (const release of pending.splice(0)) release(); },
      preparations: () => [...preparations],
      changes: () => [...changes.current],
      setHostLocale,
    };
    return () => { Reflect.deleteProperty(owner, "__languageProbe"); };
  }, []);
  return <LocaleProvider controller={language.controller}>
    <div className="app-header">
      <CustomerLanguagePicker preference={selectedLanguagePreference(language.state)} failure={language.state.status === "failed"} onPreferenceChange={language.selectPreference} />
      <ActiveLocale />
      <output id="preference-status">{language.state.status}</output>
    </div>
  </LocaleProvider>;
}
render(<Probe />, document.getElementById("root")!);

declare global { interface Window { __languageProbe: ProbeApi; } }
