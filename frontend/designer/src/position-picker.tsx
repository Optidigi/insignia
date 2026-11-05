import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ProductConfig } from "./config";
import type { Position } from "./model";
import { createProductModel } from "./model";
import { GarmentIllustration } from "./garment-preview";
import { IconCheck } from "./legacy-icons";
import { FloatingSearch, FloatingSelect } from "./compact-fields";
import { matchesSearch } from "./color-search";
import { useLocale } from "./customer-locale";

interface PositionPickerProps {
  config: ProductConfig;
  color: string;
  usedIds: string[];
  initialView: string | null;
  onChoose: (id: string) => void;
}

export function PositionPicker({
  config,
  color,
  usedIds,
  initialView,
  onChoose,
}: PositionPickerProps) {
  const { t, formatLocale } = useLocale();
  const [query, setQuery] = useState("");
  const [view, setView] = useState(initialView ?? "");
  const { imageFor, money, minimumPrintPrice } = createProductModel(config, formatLocale);
  const searchable = config.positions.length > 8;
  const resultsId = useId();
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    resultsRef.current?.scrollTo({ top: 0 });
  }, [query, view]);
  const groups = config.views
    .filter((v) => !view || v.id === view)
    .map((v) => ({
      view: v,
      positions: config.positions.filter(
        (p) =>
          p.view === v.id &&
          matchesSearch(`${p.name} ${v.label}`, query, formatLocale),
      ),
    }))
    .filter((group) => group.positions.length > 0);
  return (
    <div className="position-picker">
      {searchable && (
        <div className="position-filters">
          <FloatingSearch
            label={t("customer:placements.search")}
            clearLabel={t("customer:placements.clearSearch")}
            name="position-search"
            value={query}
            onChange={setQuery}
            controls={resultsId}
            inputRef={searchRef}
          />
          {config.views.length > 1 && (
            <FloatingSelect
              label={t("customer:placements.view")}
              name="position-view"
              value={view}
              onChange={setView}
            >
              <option value="">{t("customer:placements.allViews")}</option>
              {config.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </FloatingSelect>
          )}
        </div>
      )}
      <div
        className="position-results"
        id={resultsId}
        ref={resultsRef}
        tabIndex={0}
        role="region"
        aria-label={t("customer:placements.positions")}
      >
        {groups.map((group) => (
          <section
            className="position-group"
            key={group.view.id}
            aria-label={group.view.label}
          >
            {config.views.length > 1 && (
              <h3 id={`position-view-${group.view.id}`}>{group.view.label}</h3>
            )}
            <div className="position-options">
              {group.positions.map((p) => {
                const used = usedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    disabled={used}
                    onClick={() => onChoose(p.id)}
                  >
                    <span className="position-diagram" aria-hidden="true">
                      <PositionThumbnail
                        position={p}
                        garment={config.preview === "illustration" ? config.garment : undefined}
                        image={
                          config.preview === "photo"
                            ? imageFor(color, p.view)
                            : undefined
                        }
                        illustration={group.view.illustration}
                      />
                    </span>
                    <span className="position-label">
                      <strong>{p.name}</strong>
                    </span>
                    <span className="position-price">
                      {used ? (
                        <>
                          <IconCheck size={19} />
                            <small>{t("customer:chrome.added")}</small>
                        </>
                      ) : (
                        <>
                          {t("customer:chrome.fromPrice", {
                            price: money(minimumPrintPrice(p.id)),
                          })}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {groups.length === 0 && (
          <div className="empty-position-search" role="status">
            <p>{t("customer:placements.noMatchingPositions")}</p>
            <button
              className="text-action"
              onClick={() => {
                setQuery("");
                setView("");
                searchRef.current?.focus();
              }}
            >
              {t("customer:placements.resetFilters")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PositionThumbnail({
  position,
  garment,
  image,
  illustration,
}: {
  position: Position;
  garment: ProductConfig["garment"];
  image: string | undefined;
  illustration: ProductConfig["views"][number]["illustration"];
}) {
  return (
    <span className="placement-mini">
      {image ? (
        <img src={image} alt="" loading="lazy" />
      ) : (
        <GarmentIllustration
          garment={garment}
          color="#edf0f4"
          view={illustration}
          label=""
        />
      )}
      <span
        style={{
          left: `${position.x}%`,
          top: `${position.y}%`,
          width: `${position.width}%`,
        }}
      />
    </span>
  );
}
