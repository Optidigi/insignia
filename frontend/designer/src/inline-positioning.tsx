import { useEffect, useId, useRef, useState } from "preact/hooks";
import type {
  JSX,
  TargetedKeyboardEvent as ReactKeyboardEvent,
  TargetedPointerEvent as ReactPointerEvent,
} from "preact";
import { IconArrowLeft, IconArrowRight, IconChevronDown } from "./legacy-icons";
import { useLocale } from "./customer-locale";
import type { ProductConfig } from "./config";
import type { Artwork, Position, Print } from "./model";
import {
  artworkFootprint,
  availablePrintSizesForImages,
  clampArtworkCenterForImages,
  printSizeLabel,
  printWidthPercentForArtwork,
  resolvePrintCenter,
} from "./position-geometry";
import "./inline-positioning.css";

interface SharedProps {
  config: ProductConfig;
  position: Position;
  print: Print;
  artwork: Artwork;
  imageAspectRatio: number;
  imageAspectRatios: readonly number[];
  constraintMessage?: string | undefined;
  onChange: (nextPrint: Print) => void;
}

export interface InlineArtworkProps extends SharedProps {
  selected: boolean;
  onSelect: () => void;
  onArtworkError?: () => void;
}

export interface InlinePositionControlsProps extends SharedProps {
  canUndo: boolean;
  onUndo: () => void;
  priceForSize?: ((sizeIndex: number) => number | null) | undefined;
}

interface Point {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startCenter: Point;
  originalCenter: Point;
  latestCenter: Point;
  moved: boolean;
}

type MoveDirection = "left" | "up" | "down" | "right";
type PositioningAnnouncement =
  | { reason: "position-updated" | "at-edge" | "moved-to-fit" | "size-changed-and-moved" | "nearest-fit" | "position-reset" }
  | { reason: "artwork-moved"; direction: MoveDirection }
  | { reason: "size-changed"; sizeIndex: number };

function positioningAnnouncementText(
  announcement: PositioningAnnouncement,
  t: ReturnType<typeof useLocale>["t"],
  position: Position,
  printSize: number,
): string {
  switch (announcement.reason) {
    case "position-updated": return t("customer:positioning.positionUpdated");
    case "at-edge": return t("customer:positioning.atAllowedEdge");
    case "moved-to-fit": return t("customer:positioning.movedToFit");
    case "size-changed-and-moved": return t("customer:positioning.sizeChangedAndMoved");
    case "nearest-fit": return t("customer:positioning.movedToNearestPosition");
    case "position-reset": return t("customer:positioning.positionReset");
    case "artwork-moved":
      switch (announcement.direction) {
        case "left": return t("customer:positioning.artworkMovedLeft");
        case "up": return t("customer:positioning.artworkMovedUp");
        case "down": return t("customer:positioning.artworkMovedDown");
        case "right": return t("customer:positioning.artworkMovedRight");
      }
    case "size-changed":
      return t("customer:positioning.sizeChangedTo", {
        sizeLabel: printSizeLabel(position, announcement.sizeIndex, (dimension) =>
          t("customer:positioning.centimeters", { dimension: String(dimension) }),
        ),
      });
  }
}

const KEY_NUDGE_PERCENT = 1.5;
const CHANGE_EPSILON = 0.000001;

function isPositiveAspect(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function hasAspectConstraints(ratios: readonly number[]): boolean {
  return (
    ratios.length > 0 &&
    ratios.every((ratio) => Number.isFinite(ratio) && ratio > 0)
  );
}

function samePoint(left: Point, right: Point): boolean {
  return (
    Math.abs(left.x - right.x) <= CHANGE_EPSILON &&
    Math.abs(left.y - right.y) <= CHANGE_EPSILON
  );
}

function withCenter(
  print: Print,
  position: Position,
  center: Point,
): Print {
  const updated: Print = { ...print };
  if (
    Math.abs(center.x - position.x) <= CHANGE_EPSILON &&
    Math.abs(center.y - position.y) <= CHANGE_EPSILON
  ) {
    delete updated.position;
  } else {
    updated.position = center;
  }
  return updated;
}

function contentSize(imageAspectRatio: number) {
  return {
    width: Math.min(1, imageAspectRatio),
    height: Math.min(1, 1 / imageAspectRatio),
  };
}

function currencyFormatter(config: ProductConfig, formatLocale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency: config.currency,
  });
}

function useGeometry(
  position: Position,
  print: Print,
  artwork: Artwork,
  imageAspectRatios: readonly number[],
) {
  const artworkAspectRatio = artwork.width / artwork.height;
  const constraintsReady = hasAspectConstraints(imageAspectRatios);
  const validSizes = constraintsReady
    ? availablePrintSizesForImages(
        position,
        artworkAspectRatio,
        imageAspectRatios,
      )
    : [];
  const center = resolvePrintCenter(position, print);
  const selectedSizeIsValid = validSizes.includes(print.size);
  return {
    artworkAspectRatio,
    constraintsReady,
    validSizes,
    center,
    selectedSizeIsValid,
  };
}

export function InlineArtwork({
  config,
  position,
  print,
  artwork,
  imageAspectRatio,
  imageAspectRatios,
  constraintMessage,
  onChange,
  selected,
  onSelect,
  onArtworkError,
}: InlineArtworkProps) {
  const { t } = useLocale();
  const imageRef = useRef<HTMLImageElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const artworkErrorHandler = useRef(onArtworkError);
  artworkErrorHandler.current = onArtworkError;
  const [dragCenter, setDragCenter] = useState<Point | null>(null);
  const [artworkReady, setArtworkReady] = useState(false);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [announcement, setAnnouncement] = useState<PositioningAnnouncement | null>(null);
  const area = position.movementArea;
  const { artworkAspectRatio, constraintsReady, center, selectedSizeIsValid } =
    useGeometry(position, print, artwork, imageAspectRatios);
  const aspectReady = isPositiveAspect(imageAspectRatio);
  const imageContent = aspectReady ? contentSize(imageAspectRatio) : null;
  const widthPercent = printWidthPercentForArtwork(
    position,
    print.size,
    artworkAspectRatio,
    imageAspectRatio,
  );
  const constraintWidthPercent = printWidthPercentForArtwork(
    position,
    print.size,
    artworkAspectRatio,
    imageAspectRatios.length ? Math.max(...imageAspectRatios) : imageAspectRatio,
  );
  const boundedCenter =
    area &&
    constraintsReady &&
    aspectReady &&
    selectedSizeIsValid
      ? clampArtworkCenterForImages(
          center,
          area,
          constraintWidthPercent,
          artworkAspectRatio,
          imageAspectRatios,
        )
          : null;
  const renderCenter = dragCenter ?? center;
  const footprint =
    aspectReady && imageContent
      ? artworkFootprint(
          renderCenter,
          widthPercent,
          artworkAspectRatio,
          imageAspectRatio,
        )
      : null;
  const canMove = Boolean(
    selected &&
      area &&
      aspectReady &&
      constraintsReady &&
      artworkReady &&
      !artworkFailed &&
      !constraintMessage &&
      boundedCenter,
  );

  useEffect(() => {
    setArtworkReady(false);
    setArtworkFailed(false);
    const image = imageRef.current;
    if (!image?.complete) return;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setArtworkReady(true);
    } else {
      setArtworkFailed(true);
      artworkErrorHandler.current?.();
    }
  }, [artwork.url]);

  function cancelDrag(pointerId?: number) {
    const current = dragRef.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId))
      return;
    dragRef.current = null;
    setDragCenter(null);
    if (buttonRef.current?.hasPointerCapture(current.pointerId))
      buttonRef.current.releasePointerCapture(current.pointerId);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      !canMove ||
      !boundedCenter ||
      event.button !== 0 ||
      event.isPrimary === false ||
      dragRef.current
    )
      return;
    const wrapper = event.currentTarget.offsetParent;
    if (!(wrapper instanceof HTMLElement)) return;
    const bounds = wrapper.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !imageContent) return;

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCenter: center,
      originalCenter: center,
      latestCenter: center,
      moved: false,
    };
    setDragCenter(center);
  }

  function sampleDragPoint(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const wrapper = event.currentTarget.offsetParent;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      !(wrapper instanceof HTMLElement) ||
      !area ||
      !imageContent ||
      !canMove
    ) return null;
    const bounds = wrapper.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    drag.moved = drag.moved || Math.hypot(deltaX, deltaY) >= 2;
    // Do not show motion that will be discarded as a click on release.
    if (!drag.moved) return null;
    const next = clampArtworkCenterForImages(
      {
        x: drag.startCenter.x + (deltaX / (bounds.width * imageContent.width)) * 100,
        y: drag.startCenter.y + (deltaY / (bounds.height * imageContent.height)) * 100,
      },
      area,
      constraintWidthPercent,
      artworkAspectRatio,
      imageAspectRatios,
    );
    if (next) drag.latestCenter = next;
    return next;
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const next = sampleDragPoint(event);
    if (next) setDragCenter(next);
  }

  function commitDrag(pointerId: number) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    // Retire the gesture before releasing capture or updating the parent.
    // A later lost-capture/pointerup event must not commit it twice.
    dragRef.current = null;
    setDragCenter(null);
    if (buttonRef.current?.hasPointerCapture(pointerId))
      buttonRef.current.releasePointerCapture(pointerId);
    if (
      !canMove ||
      !drag.moved ||
      samePoint(drag.latestCenter, drag.originalCenter)
    ) return;
    onChange(withCenter(print, position, drag.latestCenter));
    setAnnouncement({ reason: "position-updated" });
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    // Some browsers deliver the release location without a final pointermove.
    sampleDragPoint(event);
    commitDrag(event.pointerId);
  }

  function nudge(deltaX: number, deltaY: number, direction: MoveDirection) {
    if (!canMove || !area || !constraintsReady) return;
    const requested = {
      x: center.x + deltaX,
      y: center.y + deltaY,
    };
    const next = clampArtworkCenterForImages(
      requested,
      area,
      constraintWidthPercent,
      artworkAspectRatio,
      imageAspectRatios,
    );
    if (!next) return;
    if (samePoint(next, center)) {
      setAnnouncement({ reason: "at-edge" });
      return;
    }
    onChange(withCenter(print, position, next));
    setAnnouncement({ reason: "artwork-moved", direction });
  }

  function onArtworkKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && dragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
      return;
    }
    if (!canMove) return;
    const moves: Record<string, [number, number, MoveDirection]> = {
      ArrowUp: [0, -KEY_NUDGE_PERCENT, "up"],
      ArrowDown: [0, KEY_NUDGE_PERCENT, "down"],
      ArrowLeft: [-KEY_NUDGE_PERCENT, 0, "left"],
      ArrowRight: [KEY_NUDGE_PERCENT, 0, "right"],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const multiplier = event.shiftKey ? 3 : 1;
    nudge(move[0] * multiplier, move[1] * multiplier, move[2]);
  }

  const areaStyle: JSX.CSSProperties | undefined =
    selected && area && imageContent && !constraintMessage
      ? {
          left: `${(0.5 - imageContent.width / 2 + ((area.x - area.width / 2) / 100) * imageContent.width) * 100}%`,
          top: `${(0.5 - imageContent.height / 2 + ((area.y - area.height / 2) / 100) * imageContent.height) * 100}%`,
          width: `${area.width * imageContent.width}%`,
          height: `${area.height * imageContent.height}%`,
        }
      : undefined;
  const artworkStyle: JSX.CSSProperties | undefined =
    footprint && imageContent
      ? {
          left: `${(0.5 - imageContent.width / 2 + ((renderCenter.x - footprint.width / 2) / 100) * imageContent.width + (footprint.width * imageContent.width) / 200) * 100}%`,
          top: `${(0.5 - imageContent.height / 2 + ((renderCenter.y - footprint.height / 2) / 100) * imageContent.height + (footprint.height * imageContent.height) / 200) * 100}%`,
          width: `${footprint.width * imageContent.width}%`,
          height: `${footprint.height * imageContent.height}%`,
        }
      : undefined;

  return (
    <>
      {areaStyle && (
        <div className="artwork-allowed-area" style={areaStyle} aria-hidden="true" />
      )}
      <button
        type="button"
        ref={buttonRef}
        className={`print-overlay inline-artwork${selected ? " selected is-selected" : ""}${dragCenter ? " is-dragging" : ""}`}
        style={artworkStyle}
        aria-label={
          selected
      ? t("customer:positioning.moveArtwork", {
          artworkName: artwork.name,
          positionName: position.name,
        })
      : t("customer:positioning.selectArtwork", {
          artworkName: artwork.name,
          positionName: position.name,
        })
        }
        aria-description={t("customer:positioning.dragAndArrowInstructions")}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
        disabled={selected && !canMove}
        onClick={() => {
          if (!selected) onSelect();
        }}
        onKeyDown={onArtworkKeyDown}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={(event) => cancelDrag(event.pointerId)}
        onLostPointerCapture={(event) => commitDrag(event.pointerId)}
      >
        {artworkFailed || !artwork.url ? (
          <span className="inline-artwork__fallback" role="status">
            {t("customer:positioning.previewUnavailable")}
          </span>
        ) : (
          <img
            ref={imageRef}
            src={artwork.url}
            alt=""
            draggable={false}
            onLoad={() => {
              setArtworkReady(true);
              setArtworkFailed(false);
            }}
            onError={() => {
              cancelDrag();
              setArtworkReady(false);
              setArtworkFailed(true);
              onArtworkError?.();
            }}
          />
        )}
        <span className="sr-only" aria-live="polite">
          {announcement
            ? positioningAnnouncementText(announcement, t, position, print.size)
            : ""}
        </span>
        {constraintMessage && selected && (
          <span className="sr-only" role="status">
            {constraintMessage}
          </span>
        )}
      </button>
    </>
  );
}

export function InlinePositionControls({
  config,
  position,
  print,
  artwork,
  imageAspectRatio,
  imageAspectRatios,
  constraintMessage,
  onChange,
  canUndo,
  onUndo,
  priceForSize,
}: InlinePositionControlsProps) {
  const { t, formatLocale } = useLocale();
  const hintId = useId();
  const area = position.movementArea;
  const { artworkAspectRatio, constraintsReady, validSizes: geometryValidSizes, center, selectedSizeIsValid: geometrySelectedSizeIsValid } =
    useGeometry(position, print, artwork, imageAspectRatios);
  const validSizes = geometryValidSizes.filter((sizeIndex) => priceForSize?.(sizeIndex) !== null);
  const selectedSizeIsValid = geometrySelectedSizeIsValid && validSizes.includes(print.size);
  const imageReady = isPositiveAspect(imageAspectRatio);
  const fitImageAspect = imageAspectRatios.length
    ? Math.max(...imageAspectRatios)
    : imageAspectRatio;
  const widthPercent = printWidthPercentForArtwork(
    position,
    print.size,
    artworkAspectRatio,
    fitImageAspect,
  );
  const formatter = currencyFormatter(config, formatLocale);
  const canEdit = Boolean(
    area &&
      imageReady &&
      constraintsReady &&
      !constraintMessage &&
      artwork.width > 0 &&
      artwork.height > 0,
  );
  const [announcement, setAnnouncement] = useState<PositioningAnnouncement | null>(null);
  const [sizeNotice, setSizeNotice] = useState<PositioningAnnouncement | null>(null);

  function sizeLabel(sizeIndex: number): string {
    return printSizeLabel(position, sizeIndex, (dimension) =>
      t("customer:positioning.centimeters", { dimension: String(dimension) }),
    );
  }

  function chooseSize(sizeIndex: number) {
    if (!canEdit || !area || !validSizes.includes(sizeIndex)) return;
    const nextWidth = printWidthPercentForArtwork(
      position,
      sizeIndex,
      artworkAspectRatio,
      fitImageAspect,
    );
    const nextCenter = clampArtworkCenterForImages(
      center,
      area,
      nextWidth,
      artworkAspectRatio,
      imageAspectRatios,
    );
    if (!nextCenter) return;
    const wasRepositioned = !samePoint(nextCenter, center);
    onChange({
      ...withCenter(print, position, nextCenter),
      size: sizeIndex,
    });
    setSizeNotice(wasRepositioned ? { reason: "moved-to-fit" } : null);
    setAnnouncement(
      wasRepositioned
        ? { reason: "size-changed-and-moved" }
        : { reason: "size-changed", sizeIndex },
    );
  }

  function resetPosition() {
    if (!canEdit || !area || !selectedSizeIsValid) return;
    const requested = { x: position.x, y: position.y };
    const nextCenter = clampArtworkCenterForImages(
      requested,
      area,
      widthPercent,
      artworkAspectRatio,
      imageAspectRatios,
    );
    if (!nextCenter) return;
    onChange(withCenter(print, position, nextCenter));
    const wasConstrained = !samePoint(nextCenter, requested);
    setSizeNotice(null);
    setAnnouncement(
      wasConstrained
        ? { reason: "nearest-fit" }
        : { reason: "position-reset" },
    );
  }

  function nudge(deltaX: number, deltaY: number, direction: MoveDirection) {
    if (!canEdit || !area || !selectedSizeIsValid) return;
    const nextCenter = clampArtworkCenterForImages(
      { x: center.x + deltaX, y: center.y + deltaY },
      area,
      widthPercent,
      artworkAspectRatio,
      imageAspectRatios,
    );
    if (!nextCenter) return;
    if (samePoint(nextCenter, center)) {
      setSizeNotice(null);
      setAnnouncement({ reason: "at-edge" });
      return;
    }
    onChange(withCenter(print, position, nextCenter));
    setSizeNotice(null);
    setAnnouncement({ reason: "artwork-moved", direction });
  }

  const priceLabel = (sizeIndex: number) => {
    if (config.artworkOnly) return "";
    if (priceForSize) {
      const cents = priceForSize(sizeIndex);
      if (cents === null) return t("customer:chrome.unavailable");
      return cents > 0
        ? `+${formatter.format(cents / 100)}`
        : t("customer:chrome.included");
    }
    const cents = position.sizePrices[sizeIndex] ?? 0;
    return cents > 0
      ? `+${formatter.format(cents / 100)}`
      : t("customer:chrome.included");
  };

  return (
    <div
      className="inline-position-controls"
      id={`adjust-position-${position.id}`}
      tabIndex={-1}
      aria-describedby={hintId}
    >
      <fieldset
        className="inline-position-controls__sizes width-options"
        disabled={!canEdit || !validSizes.length}
      >
        <legend>{t("customer:positioning.decorationSize")}</legend>
        {constraintMessage && validSizes.length > 0 && (
          <p className="inline-position-controls__message" role="status">
            {constraintMessage}
          </p>
        )}
        {validSizes.length > 6 ? (
          <label className="inline-position-controls__select">
            <span className="sr-only">{t("customer:positioning.approvedSizeSelection")}</span>
            <select
              value={selectedSizeIsValid ? print.size : ""}
              onChange={(event) => chooseSize(Number(event.currentTarget.value))}
            >
              {!selectedSizeIsValid && <option value="">{t("customer:positioning.chooseSize")}</option>}
              {validSizes.map((sizeIndex) => (
                <option value={sizeIndex} key={sizeIndex}>
                  {sizeLabel(sizeIndex)} · {priceLabel(sizeIndex)}
                </option>
              ))}
            </select>
          </label>
        ) : validSizes.length > 0 ? (
          <div
            className="inline-position-controls__presets size-options"
            role="group"
            aria-label={t("customer:positioning.approvedSizes")}
          >
            {validSizes.map((sizeIndex) => (
              <button
                type="button"
                key={sizeIndex}
                aria-pressed={print.size === sizeIndex}
                onClick={() => chooseSize(sizeIndex)}
              >
                <span>{sizeLabel(sizeIndex)}</span>
                {!config.artworkOnly && <small>{priceLabel(sizeIndex)}</small>}
              </button>
            ))}
          </div>
        ) : (
          <p className="inline-position-controls__message" role="status">
            {constraintMessage ??
              t("customer:positioning.noSizeFits")}
          </p>
        )}
        {validSizes.length > 0 && !selectedSizeIsValid && (
          <p className="inline-position-controls__message" role="status">
            {t("customer:positioning.chooseSizeThatFits")}
          </p>
        )}
      </fieldset>

      <details className="position-adjustments">
        <summary><span>{t("customer:positioning.adjustPosition")}</span><IconChevronDown size={16} aria-hidden="true" /></summary>
      <p className="inline-position-controls__hint" id={hintId}>
        {t("customer:positioning.dragInsideAreaInstructions")}
      </p>
      <div className="inline-position-controls__move-tools">
        <div
          className="inline-position-controls__nudge-row"
          role="group"
          aria-label={t("customer:positioning.nudgeArtwork")}
        >
          <button
            type="button"
            aria-label={t("customer:positioning.moveLeft")}
            disabled={!canEdit || !selectedSizeIsValid}
            onClick={() => nudge(-KEY_NUDGE_PERCENT, 0, "left")}
          >
            <IconArrowLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("customer:positioning.moveUp")}
            disabled={!canEdit || !selectedSizeIsValid}
            onClick={() => nudge(0, -KEY_NUDGE_PERCENT, "up")}
          >
            <IconArrowRight size={18} style={{ transform: "rotate(-90deg)" }} />
          </button>
          <button
            type="button"
            aria-label={t("customer:positioning.moveDown")}
            disabled={!canEdit || !selectedSizeIsValid}
            onClick={() => nudge(0, KEY_NUDGE_PERCENT, "down")}
          >
            <IconArrowRight size={18} style={{ transform: "rotate(90deg)" }} />
          </button>
          <button
            type="button"
            aria-label={t("customer:positioning.moveRight")}
            disabled={!canEdit || !selectedSizeIsValid}
            onClick={() => nudge(KEY_NUDGE_PERCENT, 0, "right")}
          >
            <IconArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="inline-position-controls__actions">
          <button
            className="text-action"
            type="button"
            disabled={!canEdit || !selectedSizeIsValid}
            onClick={resetPosition}
          >
            {t("customer:positioning.resetPosition")}
          </button>
          <button
            className="text-action"
            type="button"
            aria-label={t("customer:positioning.undoPositionChange")}
            disabled={!canUndo}
            onClick={onUndo}
          >
            {t("customer:positioning.undo")}
          </button>
        </div>
      </div>
      </details>
      {sizeNotice && (
        <p className="inline-position-controls__note">
          {positioningAnnouncementText(sizeNotice, t, position, print.size)}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement
          ? positioningAnnouncementText(announcement, t, position, print.size)
          : ""}
      </span>
    </div>
  );
}
