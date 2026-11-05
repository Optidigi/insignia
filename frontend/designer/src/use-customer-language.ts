import { useEffect, useLayoutEffect, useReducer, useRef } from "preact/hooks";
import {
  createLanguagePreferenceState,
  languagePreferenceReducer,
  type LanguagePreference,
  type LocaleUpdateResult,
} from "@insignia/ui-localization/core";
import type { CustomerWordingOverlay } from "@insignia/ui-localization/customer";
import { createCustomerLocaleController } from "./customer-locale";
import { readCustomerLanguagePreference, writeCustomerLanguagePreference } from "./customer-language-preference";
import { customerBrowserLanguages, resolveCustomerHostLocale } from "./customer-language-policy";

interface CustomerLanguageOptions {
  readonly hostLocale?: string | undefined;
  readonly wordingOverlay?: CustomerWordingOverlay | null | undefined;
  readonly onPreferenceChange?: ((language: LanguagePreference) => void) | undefined;
}

/** Audience adapter: one stable locale controller, with pure preference transitions in core. */
export function useCustomerLanguage(
  options: CustomerLanguageOptions,
  createController: typeof createCustomerLocaleController = createCustomerLocaleController,
) {
  const initial = useRef<{
    preference: LanguagePreference;
    browserLanguages: readonly string[];
  } | null>(null);
  initial.current ??= {
    preference: readCustomerLanguagePreference(),
    browserLanguages: customerBrowserLanguages(),
  };
  const automaticLocale = resolveCustomerHostLocale(options.hostLocale, initial.current.browserLanguages);
  const overlay = options.wordingOverlay ?? null;
  const controllerRef = useRef<ReturnType<typeof createCustomerLocaleController> | null>(null);
  controllerRef.current ??= createController(initial.current.preference ?? automaticLocale, {
    allowPseudoLocale: import.meta.env.DEV,
    wordingOverlay: overlay,
  });
  const controller = controllerRef.current;
  const [state, dispatch] = useReducer(languagePreferenceReducer, createLanguagePreferenceState(initial.current.preference));
  const generation = useRef(0);
  const inputs = useRef({ automaticLocale, overlay });
  const attemptedOverlay = useRef(overlay);
  const callback = useRef(options.onPreferenceChange);
  callback.current = options.onPreferenceChange;

  useLayoutEffect(() => {
    if (inputs.current.automaticLocale === automaticLocale && inputs.current.overlay === overlay) return;
    inputs.current = { automaticLocale, overlay };
    // Invalidate completion side effects immediately, before the next passive effect runs.
    dispatch({ type: "contextChanged", revision: ++generation.current });
  }, [automaticLocale, overlay]);

  useEffect(() => {
    if (state.status !== "changing" || generation.current !== state.revision) return;
    const request = state;
    let current = true;
    const isCurrent = () => current && generation.current === request.revision;
    const requestedLocale = request.requestedPreference ?? automaticLocale;
    const overlayChanged = attemptedOverlay.current !== overlay;
    attemptedOverlay.current = overlay;
    let activation: Promise<LocaleUpdateResult>;
    try {
      // Always issue a locale request, even when its target is already active:
      // that request supersedes any older preparation still in flight.
      activation = overlayChanged
        ? controller.setWordingOverlay(overlay, requestedLocale)
        : controller.setLocale(requestedLocale);
    } catch {
      dispatch({ type: "failed", revision: request.revision });
      return;
    }
    void activation.then((result) => {
      if (!isCurrent()) return;
      if (result.status === "activated") {
        dispatch({ type: "activated", revision: request.revision });
        if (request.source === "manual") {
          writeCustomerLanguagePreference(request.requestedPreference);
          callback.current?.(request.requestedPreference);
        }
      } else {
        dispatch({ type: result.status === "failed" ? "failed" : "cancelled", revision: request.revision });
      }
    }, () => {
      if (isCurrent()) dispatch({ type: "failed", revision: request.revision });
    });
    return () => { current = false; };
    // Every intent/context event has a new revision. Completion keeps that revision,
    // so it cannot launch another request or replay persistence/callback effects.
  }, [controller, state.revision]);

  return {
    controller,
    state,
    selectPreference(preference: LanguagePreference) {
      dispatch({ type: "requested", preference, revision: ++generation.current });
    },
  };
}
