import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ProductConfig } from "./config";
import { IconCheck } from "./legacy-icons";
import { swatchInk } from "./garment-preview";
import { filterColors } from "./color-search";
import { FloatingSearch } from "./compact-fields";
import {
  resolveOptionPresentation,
} from "./option-presentation";
import { useLocale } from "./customer-locale";

interface ColorPickerProps {
  colors: ProductConfig["colors"];
  selected: string;
  presentation?: ProductConfig["optionPresentation"];
  onChoose: (id: string) => void;
}

export function ColorPicker({
  colors,
  selected,
  presentation,
  onChoose,
}: ColorPickerProps) {
  const { t, formatLocale } = useLocale();
  const [query, setQuery] = useState("");
  const resultsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const optionPresentation = resolveOptionPresentation(presentation);
  const rowOption = optionPresentation.rowOption;
  const isNamedChoice = rowOption.display === "named-choice" || colors.some((choice) => !choice.hex);
  const filtered = filterColors(colors, query, formatLocale);
  const optionLabel = optionPresentation.rowOption.labelSource === "generic-selection"
    ? t("customer:options.selectionFallback")
    : presentation?.rowOption.label ?? t("customer:options.genericLabel");

  function colorName(color: ProductConfig["colors"][number]): string {
    return color.nameSource === "generic-selection"
      ? t("customer:options.selectionFallback")
      : color.name;
  }
  useLayoutEffect(() => {
    if (query.trim()) {
      resultsRef.current?.scrollTo({ top: 0 });
      return;
    }
    // The parent opens the native dialog after mount, so reveal the selection
    // once the dialog has layout, including selections late in a long palette.
    const frame = requestAnimationFrame(() =>
      selectedRef.current?.scrollIntoView({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [query]);

  return (
    <div className="color-picker">
      <FloatingSearch
        label={t("customer:options.search")}
        clearLabel={t("customer:options.clearSearch")}
        name="option-search"
        value={query}
        onChange={setQuery}
        controls={resultsId}
        inputRef={inputRef}
      />
      <span className="sr-only" role="status" aria-atomic="true">
        {query.trim()
          ? t("customer:options.optionResults", {
              filteredCount: filtered.length,
              totalCount: colors.length,
            })
          : ""}
      </span>
      <div
        className="color-results"
        ref={resultsRef}
        id={resultsId}
        role="region"
        aria-label={optionLabel}
        tabIndex={0}
      >
        <div
          className={`color-grid${isNamedChoice ? " named-choice-grid" : ""}`}
          role="group"
          aria-label={optionLabel}
        >
          {filtered.map((color) => (
            <button
              type="button"
              className={`color-option${isNamedChoice ? " named-choice-option" : ""}`}
              key={color.id}
              ref={color.id === selected ? selectedRef : null}
              aria-pressed={selected === color.id}
              onClick={() => onChoose(color.id)}
            >
              {isNamedChoice ? (
                <>
                <span className="named-choice-label">{colorName(color)}</span>
                  {selected === color.id && (
                    <IconCheck size={16} className="named-choice-check" />
                  )}
                </>
              ) : (
                <>
                  <span className="color-dot" style={{ background: color.hex }}>
                    {selected === color.id && (
                      <IconCheck
                        size={15}
                        style={{ color: swatchInk(color.hex ?? "#ffffff") }}
                      />
                    )}
                  </span>
                  <span>{colorName(color)}</span>
                </>
              )}
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="empty-color-search">
            <p>{t("customer:options.noMatchingOptions")}</p>
            <button
              className="text-action"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              {t("customer:options.clearSearchAction")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
