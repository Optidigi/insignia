/**
 * ZonePricingPanel
 *
 * Zone-centric accordion panel for the View Editor right panel.
 * One zone expanded at a time. Each zone shows placement fee, logo sizes,
 * and per-step price/scale configuration. Debounced submits to avoid
 * per-keystroke network requests.
 */

import { useCallback, useRef } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  TextField,
  Select,
  Icon,
  Checkbox,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DeleteIcon,
  DragHandleIcon,
  CursorIcon,
} from "@shopify/polaris-icons";
import { useSubmit } from "react-router";
import type { Placement } from "../lib/admin-types";

// ============================================================================
// Types
// ============================================================================

type Props = {
  placements: Placement[];
  currency: string;
  currencySymbol: string;
  selectedPlacementId: string | null;
  onSelectPlacement: (id: string | null) => void;
  methodBasePriceCents: number;
  /** Pixels per centimetre from ruler calibration; undefined = not calibrated */
  calibrationPxPerCm?: number;
  /** Natural pixel width of the product image (needed for dimension calculation) */
  imageWidth?: number;
  /** Natural pixel height of the product image (needed for dimension calculation) */
  imageHeight?: number;
  /** Current placement geometry keyed by placement ID */
  placementGeometry?: Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number; maxHeightPercent?: number }>;
};

// ============================================================================
// Constants
// ============================================================================

const ZONE_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];

// Price color coding
const PRICE_COLOR_NEGATIVE = "#16A34A"; // green — discount
const PRICE_COLOR_ZERO = "#9CA3AF";     // gray — free
const PRICE_COLOR_POSITIVE = "#D97706"; // amber — add-on

function stepPriceColor(cents: number): string {
  if (cents < 0) return PRICE_COLOR_NEGATIVE;
  if (cents === 0) return PRICE_COLOR_ZERO;
  return PRICE_COLOR_POSITIVE;
}

// ============================================================================
// Calibration dimension helper
// ============================================================================

function getAreaLabel(
  maxWidthPercent: number,
  imageWidth: number,
  pxPerCm: number,
  maxHeightPercent: number,
  imageHeight: number,
): string {
  const widthCm = ((maxWidthPercent / 100) * imageWidth) / pxPerCm;
  const heightCm = ((maxHeightPercent / 100) * imageHeight) / pxPerCm;
  const areaCm2 = widthCm * heightCm;
  return `~${Math.round(areaCm2)} cm\u00B2`;
}

// ============================================================================
// Badge summary helper
// ============================================================================

function buildBadgeSummary(p: Placement, currencySymbol: string): string {
  const baseAmount = (p.basePriceAdjustmentCents / 100).toFixed(0);
  const priceStr = `${currencySymbol}${baseAmount}`;
  const sizeStr =
    p.steps.length === 1 ? "fixed" : `${p.steps.length} sizes`;
  return `${priceStr} \u00b7 ${sizeStr}`;
}

// ============================================================================
// Component
// ============================================================================

export function ZonePricingPanel({
  placements,
  currencySymbol,
  selectedPlacementId,
  onSelectPlacement,
  calibrationPxPerCm,
  imageWidth,
  imageHeight,
  placementGeometry,
}: Props) {
  const submit = useSubmit();
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const debouncedSubmit = useCallback(
    (formData: FormData) => {
      clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = setTimeout(() => {
        submit(formData, { method: "post" });
      }, 300);
    },
    [submit],
  );

  const toggle = useCallback(
    (id: string) => {
      onSelectPlacement(selectedPlacementId === id ? null : id);
    },
    [selectedPlacementId, onSelectPlacement],
  );

  // ── No placements ──────────────────────────────────────────────────────────
  if (placements.length === 0) {
    return (
      <div
        style={{
          background: "#F9FAFB",
          borderRadius: 8,
          border: "1px solid #E5E7EB",
          padding: "24px 16px",
          textAlign: "center",
        }}
      >
        <BlockStack gap="200" inlineAlign="center">
          <Icon source={CursorIcon} tone="subdued" />
          <Text as="p" variant="bodyMd" fontWeight="semibold" tone="subdued">
            No print areas defined yet
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Add placements on the product configuration page.
          </Text>
        </BlockStack>
      </div>
    );
  }

  const expandedPlacement =
    placements.find((p) => p.id === selectedPlacementId) ?? null;

  return (
    <BlockStack gap="200">
      {placements.map((p, idx) => {
        const isExpanded = p.id === selectedPlacementId;
        const dotColor = ZONE_COLORS[idx % ZONE_COLORS.length];
        const summary = buildBadgeSummary(p, currencySymbol);

        // Dimension badge — only when calibrated and geometry is available
        const geom = placementGeometry?.[p.id];
        const dimBadge =
          calibrationPxPerCm && imageWidth && imageHeight && geom
            ? getAreaLabel(
                geom.maxWidthPercent,
                imageWidth,
                calibrationPxPerCm,
                geom.maxHeightPercent ?? geom.maxWidthPercent, // fallback for legacy zones
                imageHeight,
              )
            : null;

        return (
          <div
            key={p.id}
            style={{
              borderRadius: 8,
              border: isExpanded ? "1.5px solid #2563EB" : "1px solid #E5E7EB",
              overflow: "hidden",
              background: "#ffffff",
            }}
          >
            {/* ── Collapsed / expanded header ───────────────────────────── */}
            <button
              type="button"
              onClick={() => toggle(p.id)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: isExpanded ? "10px 14px" : "10px 14px",
                background: isExpanded ? "#EFF6FF" : "#ffffff",
                border: "none",
                cursor: "pointer",
                gap: 8,
                textAlign: "left",
              }}
            >
              {/* Colored dot */}
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              {/* Zone name */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isExpanded ? "#1D4ED8" : "#111827",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name}
              </span>
              {/* Dimension badge (calibrated real-world width) */}
              {dimBadge && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#7C3AED",
                    background: "#F5F3FF",
                    borderRadius: 8,
                    padding: "2px 6px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    fontWeight: 500,
                  }}
                >
                  {dimBadge}
                </span>
              )}
              {/* Summary badge */}
              {!isExpanded && (
                <span
                  style={{
                    fontSize: 11,
                    color: "#6B7280",
                    background: "#F3F4F6",
                    borderRadius: 10,
                    padding: "2px 8px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {summary}
                </span>
              )}
              {/* Chevron */}
              <span style={{ flexShrink: 0, color: isExpanded ? "#1D4ED8" : "#9CA3AF" }}>
                <Icon source={isExpanded ? ChevronUpIcon : ChevronDownIcon} />
              </span>
            </button>

            {/* ── Expanded content ──────────────────────────────────────── */}
            {isExpanded && (
              <div style={{ padding: "0 14px 14px" }}>
                <BlockStack gap="300">
                  {/* Section 1: Placement fee */}
                  <div style={{ paddingTop: 12 }}>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                        Placement fee
                      </Text>
                      <TextField
                        label="Placement fee"
                        labelHidden
                        type="number"
                        value={(p.basePriceAdjustmentCents / 100).toFixed(2)}
                        prefix={currencySymbol}
                        autoComplete="off"
                        onChange={(val) => {
                          const cents = Math.round(
                            parseFloat(val || "0") * 100,
                          );
                          const fd = new FormData();
                          fd.set("intent", "update-placement");
                          fd.set("placementId", p.id);
                          fd.set("name", p.name);
                          fd.set("basePriceAdjustmentCents", String(cents));
                          fd.set(
                            "hidePriceWhenZero",
                            String(p.hidePriceWhenZero),
                          );
                          fd.set(
                            "defaultStepIndex",
                            String(p.defaultStepIndex),
                          );
                          debouncedSubmit(fd);
                        }}
                      />
                    </BlockStack>
                  </div>

                  {/* Section 2: Logo sizes */}
                  <BlockStack gap="200">
                    {/* Header row */}
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                        Logo sizes
                      </Text>
                      <button
                        type="button"
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("intent", "add-step");
                          fd.set("placementId", p.id);
                          submit(fd, { method: "post" });
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          color: "#2563EB",
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        + Add size
                      </button>
                    </InlineStack>

                    {/* Default step selector (only shown when 2+ sizes) */}
                    {p.steps.length >= 2 && (
                      <Select
                        label="Default"
                        options={p.steps.map((s, si) => ({
                          label: s.label,
                          value: String(si),
                        }))}
                        value={String(p.defaultStepIndex)}
                        onChange={(val) => {
                          const fd = new FormData();
                          fd.set("intent", "update-placement");
                          fd.set("placementId", p.id);
                          fd.set("name", p.name);
                          fd.set(
                            "basePriceAdjustmentCents",
                            String(p.basePriceAdjustmentCents),
                          );
                          fd.set(
                            "hidePriceWhenZero",
                            String(p.hidePriceWhenZero),
                          );
                          fd.set("defaultStepIndex", val);
                          submit(fd, { method: "post" });
                        }}
                      />
                    )}

                    {/* Single-size hint */}
                    {p.steps.length === 1 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Only one size — customer gets this automatically. Add
                        more to let them choose.
                      </Text>
                    )}

                    {/* Step rows */}
                    {p.steps.map((step) => {
                      const priceColor = stepPriceColor(step.priceAdjustmentCents);
                      const hasMultipleSteps = p.steps.length >= 2;
                      return (
                        <div
                          key={step.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: hasMultipleSteps
                              ? "16px 1fr 68px 80px 28px"
                              : "16px 1fr 80px 28px",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          {/* Grip */}
                          <span style={{ color: "#D1D5DB", display: "flex", alignItems: "center" }}>
                            <Icon source={DragHandleIcon} />
                          </span>

                          {/* Name */}
                          <TextField
                            label="Size name"
                            labelHidden
                            value={step.label}
                            autoComplete="off"
                            onChange={(val) => {
                              const fd = new FormData();
                              fd.set("intent", "update-step");
                              fd.set("stepId", step.id);
                              fd.set("label", val);
                              fd.set("scaleFactor", String(step.scaleFactor));
                              fd.set(
                                "priceAdjustmentCents",
                                String(step.priceAdjustmentCents),
                              );
                              debouncedSubmit(fd);
                            }}
                          />

                          {/* Scale — only shown when 2+ steps */}
                          {hasMultipleSteps && (
                            <TextField
                              label="Scale"
                              labelHidden
                              type="number"
                              value={String(step.scaleFactor)}
                              suffix="x"
                              autoComplete="off"
                              onChange={(val) => {
                                const fd = new FormData();
                                fd.set("intent", "update-step");
                                fd.set("stepId", step.id);
                                fd.set("label", step.label);
                                fd.set("scaleFactor", val || "1");
                                fd.set(
                                  "priceAdjustmentCents",
                                  String(step.priceAdjustmentCents),
                                );
                                debouncedSubmit(fd);
                              }}
                            />
                          )}

                          {/* Price add-on */}
                          <div style={{ position: "relative" }}>
                            <TextField
                              label="Price add-on"
                              labelHidden
                              type="number"
                              value={(step.priceAdjustmentCents / 100).toFixed(2)}
                              prefix={currencySymbol}
                              autoComplete="off"
                              onChange={(val) => {
                                const cents = Math.round(parseFloat(val || "0") * 100);
                                const fd = new FormData();
                                fd.set("intent", "update-step");
                                fd.set("stepId", step.id);
                                fd.set("label", step.label);
                                fd.set("scaleFactor", String(step.scaleFactor));
                                fd.set("priceAdjustmentCents", String(cents));
                                debouncedSubmit(fd);
                              }}
                            />
                            {/* Price color indicator dot */}
                            <div
                              style={{
                                position: "absolute",
                                bottom: 6,
                                right: 6,
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: priceColor,
                                pointerEvents: "none",
                              }}
                            />
                          </div>

                          {/* Delete */}
                          <Button
                            icon={DeleteIcon}
                            variant="plain"
                            tone="critical"
                            accessibilityLabel={`Delete size ${step.label}`}
                            disabled={p.steps.length <= 1}
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("intent", "delete-step");
                              fd.set("stepId", step.id);
                              submit(fd, { method: "post" });
                            }}
                          />
                        </div>
                      );
                    })}
                  </BlockStack>

                  {/* Hide price when zero */}
                  <Checkbox
                    label={`Hide price when ${currencySymbol}0`}
                    checked={p.hidePriceWhenZero}
                    onChange={(checked) => {
                      const fd = new FormData();
                      fd.set("intent", "update-placement");
                      fd.set("placementId", p.id);
                      fd.set("name", p.name);
                      fd.set(
                        "basePriceAdjustmentCents",
                        String(p.basePriceAdjustmentCents),
                      );
                      fd.set("hidePriceWhenZero", String(checked));
                      fd.set(
                        "defaultStepIndex",
                        String(p.defaultStepIndex),
                      );
                      submit(fd, { method: "post" });
                    }}
                  />
                </BlockStack>
              </div>
            )}
          </div>
        );
      })}

      {/* ── No-zone-selected state ─────────────────────────────────────── */}
      {!expandedPlacement && (
        <div
          style={{
            background: "#F9FAFB",
            borderRadius: 8,
            border: "1px dashed #D1D5DB",
            padding: "16px 12px",
            marginTop: 4,
            textAlign: "center",
          }}
        >
          <BlockStack gap="100" inlineAlign="center">
            <Icon source={CursorIcon} tone="subdued" />
            <Text as="p" variant="bodySm" tone="subdued">
              Select a print area to configure
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Click a print area on the canvas or expand one above.
            </Text>
          </BlockStack>
        </div>
      )}

    </BlockStack>
  );
}

// Re-export types for parent route usage
export type { Placement, PlacementStep } from "../lib/admin-types";
