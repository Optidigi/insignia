/**
 * ZonePricingPanel
 *
 * Zone-centric accordion panel for the View Editor right panel.
 * One zone expanded at a time. Each zone shows placement fee, logo sizes,
 * and per-step price/scale configuration.
 *
 * Text/number inputs use local state — changes are submitted via the parent
 * save bar (onSave) instead of per-keystroke network requests.
 * Immediate actions (add-step, delete-step, default select, checkbox toggle)
 * still submit directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BlockStack,
  Box,
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
import { useFetcher, useRevalidator } from "react-router";
import type { Placement } from "../lib/admin-types";

// ============================================================================
// Types
// ============================================================================

/** Pending edits for a placement's own fields. */
type PlacementEdit = {
  basePriceAdjustmentCents?: number;
  hidePriceWhenZero?: boolean;
  defaultStepIndex?: number;
};

/** Pending edits for a single step's text/number fields. */
type StepEdit = {
  label?: string;
  scaleFactor?: string; // kept as string for free-form typing
  priceAdjustmentCents?: number;
};

/** All pending edits collected for a save-bar submission. */
export type PricingChange =
  | { type: "placement"; placementId: string; data: FormData }
  | { type: "step"; stepId: string; data: FormData };

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
  /** Called when the panel has unsaved text/number edits */
  onDirty?: (dirty: boolean) => void;
  /** Called by the parent save bar — returns pending FormData payloads to submit sequentially */
  onSave?: (changes: PricingChange[]) => void;
  /** Current view name — shown in panel header for context */
  viewName?: string;
  /** Called when user clicks delete on a placement */
  onDeletePlacement?: (placementId: string) => void;
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
// Helpers
// ============================================================================

/** Parse a user-typed decimal string, normalizing comma to dot for EU locales. */
function parseDecimal(val: string): number {
  const normalized = val.replace(",", ".");
  const parsed = parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Convert cents to a display string (e.g. 1050 -> "10.50"). */
function centsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2);
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
  onDirty,
  onSave,
  onDeletePlacement,
}: Props) {
  const stepFetcher = useFetcher();
  const revalidator = useRevalidator();

  // Show toast + revalidate when add-step / delete-step fetcher completes
  useEffect(() => {
    const data = stepFetcher.data as Record<string, unknown> | undefined;
    if (!data || stepFetcher.state !== "idle") return;
    if (data.success) {
      const intent = data.intent as string | undefined;
      if (intent === "add-step") window.shopify?.toast?.show("Size tier added");
      else if (intent === "delete-step") window.shopify?.toast?.show("Size tier deleted");
      else if (intent === "reorder-placements") window.shopify?.toast?.show("Order updated");
      else if (intent === "reorder-steps") window.shopify?.toast?.show("Order updated");
      revalidator.revalidate();
    } else if (data.error) {
      const msg = typeof data.error === "string" ? data.error : "An error occurred";
      window.shopify?.toast?.show(msg, { isError: true });
    }
  }, [stepFetcher.data, stepFetcher.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local edit state ─────────────────────────────────────────────────────
  // These track in-progress text/number edits that haven't been saved yet.
  const [placementEdits, setPlacementEdits] = useState<Record<string, PlacementEdit>>({});
  const [stepEdits, setStepEdits] = useState<Record<string, StepEdit>>({});
  // String states for free-form typing in price/scale fields
  const [placementPriceStrings, setPlacementPriceStrings] = useState<Record<string, string>>({});
  const [stepPriceStrings, setStepPriceStrings] = useState<Record<string, string>>({});
  const [stepScaleStrings, setStepScaleStrings] = useState<Record<string, string>>({});
  const [stepLabelStrings, setStepLabelStrings] = useState<Record<string, string>>({});

  // Drag-and-drop state
  const [draggedPlacementId, setDraggedPlacementId] = useState<string | null>(null);
  const [dragOverPlacementId, setDragOverPlacementId] = useState<string | null>(null);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);

  const submitReorderPlacements = useCallback((newOrder: string[]) => {
    const fd = new FormData();
    fd.set("intent", "reorder-placements");
    fd.set("order", JSON.stringify(newOrder));
    stepFetcher.submit(fd, { method: "post" });
  }, [stepFetcher]);

  const submitReorderSteps = useCallback((placementId: string, newOrder: string[]) => {
    const fd = new FormData();
    fd.set("intent", "reorder-steps");
    fd.set("placementId", placementId);
    fd.set("order", JSON.stringify(newOrder));
    stepFetcher.submit(fd, { method: "post" });
  }, [stepFetcher]);

  // Track dirty state
  const isDirty = Object.keys(placementEdits).length > 0 || Object.keys(stepEdits).length > 0;
  const prevDirtyRef = useRef(false);

  useEffect(() => {
    if (isDirty !== prevDirtyRef.current) {
      prevDirtyRef.current = isDirty;
      onDirty?.(isDirty);
    }
  }, [isDirty, onDirty]);

  // ── Build and expose save handler ────────────────────────────────────────
  // The parent calls collectChanges() when save bar is clicked.
  const collectChanges = useCallback((): PricingChange[] => {
    const changes: PricingChange[] = [];

    for (const [placementId, edit] of Object.entries(placementEdits)) {
      const p = placements.find((pl) => pl.id === placementId);
      if (!p) continue;
      const fd = new FormData();
      fd.set("intent", "update-placement");
      fd.set("placementId", placementId);
      fd.set("name", p.name);
      fd.set(
        "basePriceAdjustmentCents",
        String(edit.basePriceAdjustmentCents ?? p.basePriceAdjustmentCents),
      );
      fd.set("hidePriceWhenZero", String(edit.hidePriceWhenZero ?? p.hidePriceWhenZero));
      fd.set("defaultStepIndex", String(edit.defaultStepIndex ?? p.defaultStepIndex));
      changes.push({ type: "placement", placementId, data: fd });
    }

    for (const [stepId, edit] of Object.entries(stepEdits)) {
      // Find the step in placements to get current values for unedited fields
      let foundStep: { label: string; scaleFactor: number; priceAdjustmentCents: number } | undefined;
      for (const p of placements) {
        const s = p.steps.find((st) => st.id === stepId);
        if (s) { foundStep = s; break; }
      }
      if (!foundStep) continue;

      const fd = new FormData();
      fd.set("intent", "update-step");
      fd.set("stepId", stepId);
      fd.set("label", edit.label ?? foundStep.label);
      fd.set(
        "scaleFactor",
        edit.scaleFactor ?? String(foundStep.scaleFactor),
      );
      fd.set(
        "priceAdjustmentCents",
        String(edit.priceAdjustmentCents ?? foundStep.priceAdjustmentCents),
      );
      changes.push({ type: "step", stepId, data: fd });
    }

    return changes;
  }, [placementEdits, stepEdits, placements]);

  // Expose collectChanges to parent via onSave ref pattern
  const collectChangesRef = useRef(collectChanges);
  collectChangesRef.current = collectChanges;

  /** Clear all local edits (called after successful save or discard). */
  const clearEdits = useCallback(() => {
    setPlacementEdits({});
    setStepEdits({});
    setPlacementPriceStrings({});
    setStepPriceStrings({});
    setStepScaleStrings({});
    setStepLabelStrings({});
  }, []);

  // Expose collectChanges and clearEdits via ref for parent to call
  const apiRef = useRef({ collectChanges, clearEdits });
  apiRef.current = { collectChanges, clearEdits };

  // Expose the API to the parent via a callback-ref pattern:
  // The parent passes onSave which we call with collected changes.
  // We store the latest collectChanges in a ref and use a DOM event
  // to let the parent trigger it.
  useEffect(() => {
    const handler = () => {
      const changes = apiRef.current.collectChanges();
      onSave?.(changes);
      apiRef.current.clearEdits();
    };
    document.addEventListener("pricing-panel-save", handler);
    return () => document.removeEventListener("pricing-panel-save", handler);
  }, [onSave]);

  // Also listen for discard
  useEffect(() => {
    const handler = () => {
      clearEdits();
    };
    document.addEventListener("pricing-panel-discard", handler);
    return () => document.removeEventListener("pricing-panel-discard", handler);
  }, [clearEdits]);

  // ── Edit handlers ────────────────────────────────────────────────────────

  const updatePlacementPrice = useCallback((placementId: string, displayVal: string) => {
    setPlacementPriceStrings((prev) => ({ ...prev, [placementId]: displayVal }));
    const cents = Math.round(parseDecimal(displayVal) * 100);
    setPlacementEdits((prev) => ({
      ...prev,
      [placementId]: { ...prev[placementId], basePriceAdjustmentCents: cents },
    }));
  }, []);

  const updateStepLabel = useCallback((stepId: string, val: string) => {
    setStepLabelStrings((prev) => ({ ...prev, [stepId]: val }));
    setStepEdits((prev) => ({
      ...prev,
      [stepId]: { ...prev[stepId], label: val },
    }));
  }, []);

  const updateStepScale = useCallback((stepId: string, val: string) => {
    setStepScaleStrings((prev) => ({ ...prev, [stepId]: val }));
    setStepEdits((prev) => ({
      ...prev,
      [stepId]: { ...prev[stepId], scaleFactor: val || "1" },
    }));
  }, []);

  const updateStepPrice = useCallback((stepId: string, displayVal: string) => {
    setStepPriceStrings((prev) => ({ ...prev, [stepId]: displayVal }));
    const cents = Math.round(parseDecimal(displayVal) * 100);
    setStepEdits((prev) => ({
      ...prev,
      [stepId]: { ...prev[stepId], priceAdjustmentCents: cents },
    }));
  }, []);

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

        // Geometry and positioning status per-view
        const geom = placementGeometry?.[p.id];
        const isPositioned = geom != null;
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
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDraggedPlacementId(p.id);
            }}
            onDragEnd={() => {
              setDraggedPlacementId(null);
              setDragOverPlacementId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (draggedPlacementId && draggedPlacementId !== p.id) {
                setDragOverPlacementId(p.id);
              }
            }}
            onDragLeave={() => setDragOverPlacementId(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (!draggedPlacementId || draggedPlacementId === p.id) return;
              const fromIdx = placements.findIndex((pl) => pl.id === draggedPlacementId);
              const toIdx = placements.findIndex((pl) => pl.id === p.id);
              if (fromIdx === -1 || toIdx === -1) return;
              const newOrder = placements.map((pl) => pl.id);
              newOrder.splice(fromIdx, 1);
              newOrder.splice(toIdx, 0, draggedPlacementId);
              setDraggedPlacementId(null);
              setDragOverPlacementId(null);
              submitReorderPlacements(newOrder);
            }}
            style={{
              borderRadius: 8,
              border: dragOverPlacementId === p.id
                ? "1.5px solid #2563EB"
                : isExpanded
                ? "1.5px solid #2563EB"
                : "1px solid #E5E7EB",
              borderTop: dragOverPlacementId === p.id ? "2px solid #2563EB" : undefined,
              overflow: "hidden",
              background: "#ffffff",
              opacity: draggedPlacementId === p.id ? 0.4 : 1,
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
                padding: "10px 14px",
                background: isExpanded ? "#EFF6FF" : "#ffffff",
                border: "none",
                cursor: "pointer",
                gap: 8,
                textAlign: "left",
              }}
            >
              {/* Drag handle */}
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <span
                aria-hidden="true"
                style={{ color: "#D1D5DB", flexShrink: 0, cursor: "grab", display: "flex", alignItems: "center" }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Box>
                  <Icon source={DragHandleIcon} tone="subdued" />
                </Box>
              </span>
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
              {/* Position status badge */}
              {!isExpanded && (
                <span
                  style={{
                    fontSize: 10,
                    color: isPositioned ? "#16A34A" : "#D97706",
                    background: isPositioned ? "#F0FDF4" : "#FFFBEB",
                    borderRadius: 8,
                    padding: "2px 6px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    fontWeight: 500,
                  }}
                >
                  {isPositioned ? "Positioned" : "Not placed"}
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
                        type="text"
                        inputMode="decimal"
                        value={
                          placementPriceStrings[p.id] ??
                          centsToDisplay(p.basePriceAdjustmentCents)
                        }
                        prefix={currencySymbol}
                        autoComplete="off"
                        onChange={(val) => updatePlacementPrice(p.id, val)}
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
                          stepFetcher.submit(fd, { method: "post" });
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
                        value={String(placementEdits[p.id]?.defaultStepIndex ?? p.defaultStepIndex)}
                        onChange={(val) => {
                          setPlacementEdits((prev) => ({
                            ...prev,
                            [p.id]: { ...prev[p.id], defaultStepIndex: parseInt(val, 10) },
                          }));
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

                    {/* Step column headers — only shown when 2+ sizes */}
                    {p.steps.length >= 2 && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "16px 1fr 68px 80px 28px",
                          gap: 6,
                          paddingBottom: 2,
                        }}
                      >
                        <span />
                        <Text as="span" variant="bodySm" tone="subdued">Name</Text>
                        <Text as="span" variant="bodySm" tone="subdued">Scale</Text>
                        <Text as="span" variant="bodySm" tone="subdued">Price</Text>
                        <span />
                      </div>
                    )}

                    {/* Step rows */}
                    {p.steps.map((step) => {
                      const editedPriceCents = stepEdits[step.id]?.priceAdjustmentCents;
                      const effectivePriceCents = editedPriceCents ?? step.priceAdjustmentCents;
                      const priceColor = stepPriceColor(effectivePriceCents);
                      const hasMultipleSteps = p.steps.length >= 2;
                      return (
                        <div
                          key={step.id}
                          draggable={hasMultipleSteps}
                          onDragStart={hasMultipleSteps ? (e) => {
                            e.dataTransfer.effectAllowed = "move";
                            setDraggedStepId(step.id);
                          } : undefined}
                          onDragEnd={hasMultipleSteps ? () => {
                            setDraggedStepId(null);
                            setDragOverStepId(null);
                          } : undefined}
                          onDragOver={hasMultipleSteps ? (e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (draggedStepId && draggedStepId !== step.id) {
                              setDragOverStepId(step.id);
                            }
                          } : undefined}
                          onDragLeave={hasMultipleSteps ? () => setDragOverStepId(null) : undefined}
                          onDrop={hasMultipleSteps ? (e) => {
                            e.preventDefault();
                            if (!draggedStepId || draggedStepId === step.id) return;
                            const fromIdx = p.steps.findIndex((s) => s.id === draggedStepId);
                            const toIdx = p.steps.findIndex((s) => s.id === step.id);
                            if (fromIdx === -1 || toIdx === -1) return;
                            const newOrder = p.steps.map((s) => s.id);
                            newOrder.splice(fromIdx, 1);
                            newOrder.splice(toIdx, 0, draggedStepId);
                            setDraggedStepId(null);
                            setDragOverStepId(null);
                            submitReorderSteps(p.id, newOrder);
                          } : undefined}
                          style={{
                            display: "grid",
                            gridTemplateColumns: hasMultipleSteps
                              ? "16px 1fr 68px 80px 28px"
                              : "16px 1fr 80px 28px",
                            gap: 6,
                            alignItems: "center",
                            opacity: draggedStepId === step.id ? 0.4 : 1,
                            borderTop: dragOverStepId === step.id ? "2px solid #2563EB" : undefined,
                          }}
                        >
                          {/* Grip */}
                          <span style={{ color: "#D1D5DB", display: "flex", alignItems: "center", cursor: hasMultipleSteps ? "grab" : "default" }}>
                            <Box>
                              <Icon source={DragHandleIcon} tone="subdued" />
                            </Box>
                          </span>

                          {/* Name */}
                          <TextField
                            label="Size name"
                            labelHidden
                            value={stepLabelStrings[step.id] ?? step.label}
                            autoComplete="off"
                            onChange={(val) => updateStepLabel(step.id, val)}
                          />

                          {/* Scale — only shown when 2+ steps */}
                          {hasMultipleSteps && (
                            <TextField
                              label="Scale"
                              labelHidden
                              type="text"
                              inputMode="decimal"
                              value={
                                stepScaleStrings[step.id] ??
                                String(step.scaleFactor)
                              }
                              suffix="x"
                              autoComplete="off"
                              onChange={(val) => updateStepScale(step.id, val)}
                              onBlur={() => {
                                const raw = parseFloat(
                                  stepScaleStrings[step.id] ??
                                    String(step.scaleFactor),
                                );
                                if (!Number.isNaN(raw)) {
                                  const clamped = Math.max(
                                    0.1,
                                    Math.min(1, raw),
                                  );
                                  updateStepScale(step.id, String(clamped));
                                }
                              }}
                            />
                          )}

                          {/* Price add-on */}
                          <div style={{ position: "relative" }}>
                            <TextField
                              label="Price add-on"
                              labelHidden
                              type="text"
                              inputMode="decimal"
                              value={
                                stepPriceStrings[step.id] ??
                                centsToDisplay(step.priceAdjustmentCents)
                              }
                              prefix={currencySymbol}
                              autoComplete="off"
                              onChange={(val) => updateStepPrice(step.id, val)}
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
                              stepFetcher.submit(fd, { method: "post" });
                            }}
                          />
                        </div>
                      );
                    })}
                  </BlockStack>

                  {/* Hide price when zero */}
                  <Checkbox
                    label={`Hide price when ${currencySymbol}0`}
                    checked={placementEdits[p.id]?.hidePriceWhenZero ?? p.hidePriceWhenZero}
                    onChange={(checked) => {
                      setPlacementEdits((prev) => ({
                        ...prev,
                        [p.id]: { ...prev[p.id], hidePriceWhenZero: checked },
                      }));
                    }}
                  />

                  {/* Delete placement */}
                  {onDeletePlacement && (
                    <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10 }}>
                      <Button
                        icon={DeleteIcon}
                        variant="plain"
                        tone="critical"
                        onClick={() => onDeletePlacement(p.id)}
                      >
                        Delete print area
                      </Button>
                    </div>
                  )}
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
