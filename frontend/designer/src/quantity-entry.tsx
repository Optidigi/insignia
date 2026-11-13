import { useMemo, useRef, useState } from "preact/hooks";
import type { ProductConfig } from "./config";
import { isValidQuantity, type Quantities } from "./model";
import { quantityLayout, type QuantityCell } from "./quantity-layout";
import { IconX } from "./legacy-icons";
import type { ValidationIssue } from "./validation-summary";
import { useLocale } from "./customer-locale";

interface QuantityEntryProps {
  config: ProductConfig;
  quantities: Quantities;
  colorRows: string[];
  validationIssues: ValidationIssue[];
  onChange: (row: string, size: string, value: number) => void;
  onSelectRow: (row: string) => void;
  onRemoveRow: (
    row: string,
    name: string,
    nameSource?: "generic-selection",
  ) => void;
  onRemoveQuantity: (key: string) => void;
  onAddRow: () => void;
}

/**
 * The quantity a field's text means: 0 when empty, NaN unless it is plain digits. The field is a
 * text input because a number input rewrites or drops typed separators ("1,5" became 15) (#416).
 */
function enteredQuantity(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function QuantityEntry({
  config,
  quantities,
  colorRows,
  validationIssues,
  onChange,
  onSelectRow,
  onRemoveRow,
  onRemoveQuantity,
  onAddRow,
}: QuantityEntryProps) {
  const { t, formatLocale } = useLocale();
  const layout = useMemo(() => quantityLayout(config), [config]);
  const cells = useMemo(
    () => new Map(layout.cells.map((cell) => [`${cell.rowId}:${cell.sizeId}`, cell])),
    [layout],
  );
  const [search, setSearch] = useState("");
  const [focusedSize, setFocusedSize] = useState<string | null>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const unavailable = Object.entries(quantities).filter(
    ([key, value]) => (value ?? 0) !== 0 && !cells.get(key)?.available,
  );
  const compact = layout.kind === "compact" || layout.kind === "single";
  const named =
    config.optionPresentation?.rowOption.display !== "swatch" ||
    config.colors.some((row) => !row.hex);
  const searchWords = search.toLocaleLowerCase(formatLocale).trim().split(/\s+/).filter(Boolean);
  const visibleSizes = config.sizes.filter(
    (size) =>
      size.id === focusedSize ||
      searchWords.every((word) => size.label.toLocaleLowerCase(formatLocale).includes(word)) ||
      colorRows.some((row) => (quantities[`${row}:${size.id}`] ?? 0) !== 0),
  );
  const longList = layout.kind === "list" && config.sizes.length > 12;
  const columnOptionLabel = config.optionPresentation?.columnOption.label ?? t("customer:options.genericLabel");

  function rowName(row: ProductConfig["colors"][number] | undefined): string {
    if (!row) return t("customer:options.genericLabel");
    return row.nameSource === "generic-selection"
      ? t("customer:options.selectionFallback")
      : row.name;
  }

  function field(cell: QuantityCell, caption: string | null, stepper: boolean) {
    const row = config.colors.find((row) => row.id === cell.rowId);
    const size = config.sizes.find((size) => size.id === cell.sizeId);
    if (!row || !size) return null;
    const key = `${row.id}:${size.id}`;
    const target = `quantity-${row.id}-${size.id}`;
    const value = quantities[key] ?? 0;
    const invalid = !isValidQuantity(value, config.maxQuantity);
    const issue = validationIssues.find((issue) => issue.target === target);
    const error = invalid
      ? t("customer:quantities.useWholeNumbers", { maxQuantity: config.maxQuantity })
      : issue?.message;
    const own = inputs.current.get(key);
    // Text that already means the stored quantity stays as typed while the shopper edits it, and
    // invalid text stays visible after blur. Rewriting it mid-entry moved the caret, so typing
    // "1.5" stored 51 (#416). Otherwise the field shows the stored quantity.
    const kept =
      own !== undefined &&
      Object.is(enteredQuantity(own.value), value) &&
      ((own.getRootNode() as Document | ShadowRoot).activeElement === own || !Number.isFinite(value));
    const shown = !cell.available
      ? ""
      : kept
        ? own.value
        : Number.isFinite(value)
          ? `${value || (stepper ? 0 : "")}`
          : "";
    const name = t("customer:quantities.fieldLabel", {
      rowName: rowName(row),
      sizeLabel: size.label,
    });
    const input = (
      <input
        id={target}
        type="text"
        inputMode="numeric"
        name={`${row.id}-${size.id}-quantity`}
        disabled={!cell.available}
        title={!cell.available ? t("customer:quantities.unavailableForSelection") : undefined}
        autoComplete="off"
        aria-label={name}
        aria-invalid={invalid || !!issue || undefined}
        aria-describedby={error ? `${target}-error` : undefined}
        ref={(input) => {
          if (input) inputs.current.set(key, input);
          else inputs.current.delete(key);
        }}
        value={shown}
        placeholder={cell.available ? "0" : "—"}
        onFocus={(event) => {
          setFocusedSize(size.id);
          onSelectRow(row.id);
          event.currentTarget.select();
        }}
        onBlur={() => setFocusedSize(null)}
        onInput={(event) => onChange(row.id, size.id, enteredQuantity(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const panel = event.currentTarget.closest(".panel-content");
          const fields = Array.from(
            panel?.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]:enabled') ?? [],
          );
          const next =
            fields[fields.indexOf(event.currentTarget) + 1] ??
            panel?.parentElement?.querySelector<HTMLButtonElement>(".panel-footer .primary-button");
          next?.focus();
        }}
      />
    );
    return (
      <div className={`quantity-field${!cell.available ? " unavailable-size" : ""}`} key={key}>
        {caption !== null && <label htmlFor={target}>{caption}</label>}
        {stepper ? (
          <div className="quantity-stepper" role="group" aria-label={name}>
            <button
              type="button"
              aria-label={t("customer:quantities.decreaseQuantity", { quantityName: name })}
              disabled={invalid || value <= 0 || !cell.available}
              onClick={() => onChange(row.id, size.id, value - 1)}
            >
              −
            </button>
            {input}
            <button
              type="button"
              aria-label={t("customer:quantities.increaseQuantity", { quantityName: name })}
              disabled={invalid || value >= config.maxQuantity || !cell.available}
              onClick={() => onChange(row.id, size.id, value + 1)}
            >
              +
            </button>
          </div>
        ) : (
          input
        )}
        {error && (
          <p className="quantity-error" id={`${target}-error`} role="status">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={entryRef}
      tabIndex={-1}
      aria-label={t("customer:quantities.heading")}
      className={`quantity-entry quantity-entry-${layout.kind}`}
      data-quantity-layout={layout.kind}
    >
      <div className="section-heading">
        <h2>{t("customer:quantities.heading")}</h2>
      </div>
      {unavailable.length > 0 && (
        <section
          id="quantity-unavailable-selections"
          tabIndex={-1}
          className="quantity-recovery"
          aria-label={t("customer:quantities.unavailableSelections")}
        >
          <h3>{t("customer:quantities.unavailableSelections")}</h3>
          {unavailable.map(([key, value]) => {
            const [rowId, sizeId] = key.split(":");
            const row = config.colors.find((row) => row.id === rowId);
            const size = config.sizes.find((size) => size.id === sizeId);
            const name = row && size
              ? t("customer:quantities.selectionName", {
                  rowName: rowName(row),
                  sizeLabel: size.label,
                })
              : t("customer:quantities.unavailableSelection");
            return (
              <div className="quantity-recovery-row" key={key}>
                <span>
                  <strong>{name}</strong>
                  <small>
                    {isValidQuantity(value ?? 0, config.maxQuantity)
                      ? t("customer:quantities.quantityCount", { count: value ?? 0 })
                      : t("customer:quantities.checkQuantity")}
                  </small>
                </span>
                <button
                  type="button"
                  aria-label={t("customer:quantities.removeQuantity", {
                    selectionName: name,
                  })}
                  onClick={() => {
                    onRemoveQuantity(key);
                    window.requestAnimationFrame(() =>
                      (
                        entryRef.current?.querySelector<HTMLElement>(
                          'input[inputmode="numeric"]:enabled, .quantity-recovery-row button',
                        ) ?? entryRef.current
                      )?.focus(),
                    );
                  }}
                >
                  {t("customer:quantities.remove")}
                </button>
              </div>
            );
          })}
        </section>
      )}
      {compact ? (
        <div className="compact-quantities">
          {layout.cells.map((cell) => {
            if (unavailable.some(([key]) => key === `${cell.rowId}:${cell.sizeId}`)) return null;
            const row = config.colors.find((row) => row.id === cell.rowId);
            const size = config.sizes.find((size) => size.id === cell.sizeId);
            if (!row || !size) return null;
            const primary = config.sizes.length > 1 ? size.label : rowName(row);
            const secondary = config.sizes.length > 1 ? rowName(row) : size.label;
            return (
              <div className="compact-quantity-row" key={`${row.id}:${size.id}`}>
                <div className="compact-quantity-identity">
                  <strong>{primary}</strong>
                  <span>{secondary}</span>
                </div>
                {cell.available ? (
                  field(cell, null, true)
                ) : (
                  <span className="quantity-unavailable">{t("customer:chrome.unavailable")}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {longList && (
            <label className="quantity-search">
              {columnOptionLabel}
              <input
                type="search"
                placeholder={t("customer:quantities.searchOptions")}
                value={search}
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
            </label>
          )}
          {colorRows.map((rowId) => {
            const row = config.colors.find((row) => row.id === rowId);
            if (!row) return null;
            const count = config.sizes.reduce((sum, size) => {
              const value = quantities[`${row.id}:${size.id}`] ?? 0;
              return sum + (isValidQuantity(value, config.maxQuantity) ? value : 0);
            }, 0);
            return (
              <div className="quantity-card" key={rowId}>
                <div className="quantity-card-heading">
                  <div className="quantity-group-name">
                    {!named && <span className="mini-swatch" style={{ background: row.hex }} />}
                    <strong>{rowName(row)}</strong>
                  </div>
                  <span className="quantity-group-count">
                    {count > 0 ? t("customer:quantities.quantityCount", { count }) : ""}
                  </span>
                  {colorRows.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t("customer:quantities.removeRowItems", {
                        rowName: rowName(row),
                      })}
                      onClick={() => onRemoveRow(
                        row.id,
                        row.name,
                        row.nameSource === "generic-selection" ? row.nameSource : undefined,
                      )}
                    >
                      <IconX size={15} />
                    </button>
                  )}
                </div>
                <span className="quantity-axis-label">
                  {columnOptionLabel}
                </span>
                <div className={layout.kind === "list" ? "quantity-choice-list" : "quantity-grid"}>
                  {visibleSizes.map((size) => {
                    const cell = cells.get(`${row.id}:${size.id}`);
                    return cell ? (
                      field(cell, size.label, false)
                    ) : (
                      <div className="quantity-missing" key={`${row.id}:${size.id}`}>
                        <span>{size.label}</span>
                        <span
                          aria-label={
                            config.variantMatrix
                              ? t("customer:quantities.notOffered")
                              : t("customer:quantities.unavailableForSelection")
                          }
                        >
                          —
                        </span>
                      </div>
                    );
                  })}
                </div>
                {visibleSizes.length === 0 && (
                      <p className="quantity-no-results" role="status">
                        {t("customer:quantities.noMatchingOptions")}
                      </p>
                )}
              </div>
            );
          })}
          {colorRows.length < config.colors.length && (
            <button type="button" className="add-colour" onClick={onAddRow}>
              {t("customer:quantities.addOption")}
            </button>
          )}
        </>
      )}
      {!layout.cells.some((cell) => cell.available) && (
        <p className="quantity-no-results" role="status">
          {t("customer:quantities.noOptionsAvailable")}
        </p>
      )}
    </div>
  );
}
