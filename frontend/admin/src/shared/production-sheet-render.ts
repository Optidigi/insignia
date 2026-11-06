import { PurchasePrivateUrlSchema, type PurchaseView } from '@insignia/contracts';
import { type AdminLocaleSnapshot, adminMessage, createAdminTranslator } from '@insignia/ui-localization/admin';
import { formatExactCount } from '@insignia/ui-localization/core';
import { type GeometryV1, projectScene, validateGeometry } from '@insignia/ui-visualizer/geometry';
import { authenticatedJson } from './admin-request.js';
import {
  assertProductionSheetAvailable,
  type ExportMessage,
  ProductionSheetError,
  type ProductionWarning,
  productionArtworkAvailable,
  productionOrderWarnings,
  productionSheetOrderMessage,
} from './production-sheet.js';

export interface ProductionSheetProgress {
  phase: 'design' | 'artwork' | 'garment' | 'page';
  design: number;
  designs: number;
  label: ExportMessage;
}

export interface ProductionSheetLimits {
  maxPages: number;
  maxBytes: number;
}

export interface ProductionSheetResult {
  pages: { url: string; label: string; selectorLabel?: string; png: Uint8Array<ArrayBuffer> }[];
  expiresAt: number;
  hold: boolean;
  warnings: ProductionWarning[];
  generatedAt: string;
  documentTitle?: string;
  dispose(): void;
}

const english = createAdminTranslator('en');

const pageWidth = 1240,
  pageHeight = 1754,
  margin = 64;
/** Rasterize the worksheet at 150dpi so browser Unicode/shaping matches its on-screen labels. */
export async function renderProductionSheet(
  purchase: PurchaseView,
  signal: AbortSignal,
  onProgress?: (progress: ProductionSheetProgress) => void,
  limits?: ProductionSheetLimits,
  localization: AdminLocaleSnapshot = english,
): Promise<ProductionSheetResult> {
  if (
    limits &&
    (!Number.isSafeInteger(limits.maxPages) ||
      limits.maxPages <= 0 ||
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxBytes <= 0)
  )
    throw new ProductionSheetError('budgetInvalid', adminMessage('exports:productionSheet.errors.budgetInvalid'));
  const maxPages = Math.min(200, limits?.maxPages ?? 200);
  const maxBytes = Math.min(64 * 1024 * 1024, limits?.maxBytes ?? 64 * 1024 * 1024);
  const preparedAt = Date.now();
  assertProductionSheetAvailable(purchase, preparedAt);
  const urls: string[] = [];
  const images = new Map<string, ImageBitmap>();
  let totalBytes = 0;
  let decodedPixels = 0;
  let encodedBytes = 0;
  let expiresAt = Math.min(
    ...purchase.groups.flatMap((group) => [
      Date.parse(group.payloadExpiresAt),
      ...group.placements
        .filter((placement) => productionArtworkAvailable(group, placement, preparedAt))
        .map((placement) => Date.parse(placement.currentExpiresAt ?? '')),
    ]),
  );
  let currentDesign = 0;
  function report(phase: ProductionSheetProgress['phase'], label: ExportMessage) {
    onProgress?.({
      phase,
      design: currentDesign,
      designs: purchase.groups.length,
      label,
    });
  }
  const generatedAt = new Date().toISOString();
  const warnings = productionOrderWarnings(purchase);
  const geometries = new Map<number, GeometryV1>();
  for (const group of purchase.groups) {
    try {
      if (!group.geometry)
        throw new ProductionSheetError(
          'geometryMissing',
          adminMessage('exports:productionSheet.errors.geometryMissing'),
        );
      const geometry = validateGeometry(group.geometry as GeometryV1);
      if (
        group.placements.some(
          (placement) =>
            !geometry.views.some((view) => view.placements.some((area) => area.id === placement.id)) ||
            !geometry.steps.some((step) => step.id === placement.stepId),
        )
      )
        throw new ProductionSheetError(
          'placementDetailsMissing',
          adminMessage('exports:productionSheet.errors.placementDetailsMissing'),
        );
      geometries.set(group.index, geometry);
    } catch {
      if (!warnings.some((warning) => warning.code === 'placementPreviewUnavailable'))
        warnings.push({
          code: 'placementPreviewUnavailable',
          tone: 'caution',
          message: adminMessage('exports:productionSheet.warnings.placementPreviewUnavailable'),
          archiveMessage: adminMessage('exports:artworkArchive.warnings.placementPreviewUnavailable'),
        });
    }
  }
  const hold = warnings.some((warning) => warning.tone === 'caution');
  const check = () => {
    signal.throwIfAborted();
    if (Date.now() >= expiresAt)
      throw new ProductionSheetError('artworkExpired', adminMessage('exports:productionSheet.errors.artworkExpired'));
  };
  async function image(url: string): Promise<ImageBitmap> {
    check();
    const cached = images.get(url);
    if (cached) return cached;
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok || !response.body)
      throw new ProductionSheetError(
        'imageUnavailable',
        adminMessage('exports:productionSheet.errors.imageUnavailable'),
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        totalBytes += value.byteLength;
        if (size > 2 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024)
          throw new ProductionSheetError(
            'imageDataTooLarge',
            adminMessage('exports:productionSheet.errors.imageDataTooLarge'),
          );
        chunks.push(new Uint8Array(value));
      }
    } finally {
      await reader.cancel();
    }
    check();
    const result = await createImageBitmap(new Blob(chunks));
    try {
      check();
    } catch (error) {
      result.close();
      throw error;
    }
    if (result.width > 12000 || result.height > 12000 || result.width * result.height > 40_000_000) {
      result.close();
      throw new ProductionSheetError(
        'imageDimensionsUnsupported',
        adminMessage('exports:productionSheet.errors.imageDimensionsUnsupported'),
      );
    }
    decodedPixels += result.width * result.height;
    if (decodedPixels > 32_000_000) {
      result.close();
      throw new ProductionSheetError(
        'imageCountExceeded',
        adminMessage('exports:productionSheet.errors.imageCountExceeded'),
      );
    }
    images.set(url, result);
    return result;
  }
  const pages: ProductionSheetResult['pages'] = [];
  const contentWidth = pageWidth - margin * 2;
  const orderLabel = localization.message(productionSheetOrderMessage(purchase));
  const artworkNumbers = new Map<string, number>();
  for (const group of purchase.groups)
    for (const placement of group.placements)
      if (
        productionArtworkAvailable(group, placement, preparedAt) &&
        placement.currentAssetId &&
        !artworkNumbers.has(placement.currentAssetId)
      )
        artworkNumbers.set(placement.currentAssetId, artworkNumbers.size + 1);
  function drawingSurface() {
    const canvas = document.createElement('canvas');
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const context = canvas.getContext('2d');
    if (!context)
      throw new ProductionSheetError(
        'renderUnavailable',
        adminMessage('exports:productionSheet.errors.renderUnavailable'),
      );
    return { canvas, context };
  }
  let { canvas, context } = drawingSurface();
  let y = 0;
  let title = '';
  let productTitle = '';
  let quantity = 0n;
  let productWidth = contentWidth - 260;
  let designPage = 0;
  let section = '';
  let continuationDetail = '';
  const ink = '#181818';
  const muted = '#5a5a5a';
  function draw(value: string, x: number, baseline: number, size = 24, weight = 400, color = '#202020') {
    context.font = `${weight} ${size}px system-ui, sans-serif`;
    context.fillStyle = color;
    context.fillText(value, x, baseline);
  }
  function wrapped(value: string, size = 24, weight = 400, width = contentWidth): string[] {
    context.font = `${weight} ${size}px system-ui, sans-serif`;
    const lines: string[] = [];
    let line = '';
    for (const word of value.replace(/[\r\n\t]+/g, ' ').split(/(?<=\s)/u)) {
      if (context.measureText(line + word).width <= width) {
        line += word;
        continue;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = '';
      }
      for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)) {
        if (context.measureText(line + segment).width > width && line) {
          lines.push(line.trimEnd());
          line = '';
        }
        line += segment;
      }
    }
    if (line) lines.push(line.trimEnd());
    return lines;
  }
  function compact(value: string, size: number, weight: number, width: number): string {
    const lines = wrapped(value, size, weight, width);
    if (lines.length <= 1) return value;
    let first = lines[0] ?? '';
    context.font = `${weight} ${size}px system-ui, sans-serif`;
    while (context.measureText(`${first}…`).width > width) first = first.slice(0, -1);
    return `${first}…`;
  }
  function rule(baseline: number, color = '#c8c8c8') {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(margin, baseline);
    context.lineTo(pageWidth - margin, baseline);
    context.stroke();
  }
  // P references carry identity in monochrome; colour is a second, faster visual cue.
  const placementColors = ['#0072b2', '#b34f00', '#00805a', '#864994', '#91572e', '#007f8b'];
  const placementColor = (index: number) => placementColors[index % placementColors.length] ?? ink;
  function badge(value: string, x: number, top: number, index: number) {
    context.save();
    const color = placementColor(index);
    context.fillStyle = '#fff';
    context.fillRect(x, top, 56, 34);
    context.globalAlpha = 0.12;
    context.fillStyle = color;
    context.fillRect(x, top, 56, 34);
    context.globalAlpha = 1;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([2, 4]);
    context.strokeRect(x, top, 56, 34);
    context.restore();
    draw(value, x + 8, top + 24, 20, 700, ink);
  }
  function newPage(repeatSection = true) {
    if (pages.length >= maxPages)
      throw new ProductionSheetError(
        'pageBudgetExceeded',
        adminMessage('exports:productionSheet.errors.pageBudgetExceeded'),
      );
    designPage++;
    ({ canvas, context } = drawingSurface());
    context.fillStyle = '#fff';
    context.fillRect(0, 0, pageWidth, pageHeight);
    draw(localization.t('exports:productionSheet.pdf.header'), margin, 68, 18, 650, muted);
    const headerColumnWidth = (contentWidth - 48) / 2;
    draw(compact(orderLabel, 42, 750, headerColumnWidth), margin, 116, 42, 750);
    const pageContext = localization.t('exports:productionSheet.pageContext', {
      designName: title,
      formattedDesignCount: new Intl.NumberFormat(localization.formatLocale).format(purchase.groups.length),
      formattedPage: new Intl.NumberFormat(localization.formatLocale).format(designPage),
    });
    context.font = '650 20px system-ui, sans-serif';
    const pageContextWidth = Math.min(context.measureText(pageContext).width, headerColumnWidth);
    draw(compact(pageContext, 20, 650, headerColumnWidth), pageWidth - margin - pageContextWidth, 111, 20, 650, muted);
    rule(142, '#d9dfe3');
    const countFormat = formatExactCount(quantity, localization.formatLocale);
    const count = countFormat.formatted;
    const countSize = Math.min(48, 600 / count.length);
    context.font = `750 ${countSize}px system-ui, sans-serif`;
    const countWidth = context.measureText(count).width;
    productWidth = contentWidth - Math.max(260, countWidth + 36);
    draw(compact(productTitle, 29, 650, productWidth), margin, 208, 29, 650);
    draw(count, pageWidth - margin - countWidth, 202, countSize, 750);
    const unit =
      countFormat.kind === 'plural'
        ? localization.t('exports:productionSheet.unit', { count: countFormat.count })
        : localization.t('exports:productionSheet.unitExact');
    context.font = '500 19px system-ui, sans-serif';
    draw(unit, pageWidth - margin - context.measureText(unit).width, 229, 19, 500, muted);
    y = 264;
    if (warnings.length) {
      const lines = wrapped(
        warnings.map((warning) => localization.message(warning.message)).join('  /  '),
        19,
        650,
        contentWidth - 36,
      );
      const height = lines.length * 27 + 22;
      context.fillStyle = '#eeeeee';
      context.fillRect(margin, y - 13, contentWidth, height);
      context.fillStyle = ink;
      context.fillRect(margin, y - 13, 5, height);
      for (const [index, line] of lines.entries()) draw(line, margin + 18, y + 10 + index * 27, 19, 650);
      y += height + 12;
    }
    if (repeatSection && designPage > 1 && section) {
      draw(localization.t('exports:productionSheet.pdf.continuedSection', { section }), margin, y + 24, 23, 650);
      y += 46;
      if (continuationDetail) {
        draw(compact(continuationDetail, 20, 600, contentWidth), margin, y + 20, 20, 600, muted);
        y += 38;
      }
    }
  }
  async function finish() {
    check();
    report(
      'page',
      adminMessage('exports:productionSheet.progress.page', {
        formattedDesignNumber: new Intl.NumberFormat(localization.formatLocale).format(currentDesign),
        formattedDesignCount: new Intl.NumberFormat(localization.formatLocale).format(purchase.groups.length),
        formattedPage: new Intl.NumberFormat(localization.formatLocale).format(pages.length + 1),
      }),
    );
    rule(pageHeight - 115);
    draw(localization.t('exports:productionSheet.pdf.footerGuidance'), margin, pageHeight - 82, 18);
    draw(
      localization.t('exports:productionSheet.pdf.footerTimestamp', {
        version: new Intl.NumberFormat(localization.formatLocale).format(purchase.artworkVersion),
        date: new Date(generatedAt).toISOString().slice(0, 16).replace('T', ' '),
      }),
      margin,
      pageHeight - 51,
      17,
      400,
      '#555',
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(
                new ProductionSheetError(
                  'imageEncodeFailed',
                  adminMessage('exports:productionSheet.errors.imageEncodeFailed'),
                ),
              ),
        'image/png',
      ),
    );
    check();
    encodedBytes += blob.size;
    if (encodedBytes > maxBytes)
      throw new ProductionSheetError(
        'imageBudgetExceeded',
        adminMessage('exports:productionSheet.errors.imageBudgetExceeded'),
      );
    const url = URL.createObjectURL(blob);
    urls.push(url);
    pages.push({
      url,
      label: localization.t('exports:productionSheet.pageLabel', {
        designName: title,
        formattedPage: new Intl.NumberFormat(localization.formatLocale).format(pages.length + 1),
      }),
      png: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  async function room(height: number, repeatSection = true): Promise<boolean> {
    if (y + height <= pageHeight - 145) return false;
    await finish();
    newPage(repeatSection);
    return true;
  }
  async function paragraph(value: string, size = 24, weight = 400, width = contentWidth, x = margin) {
    for (const line of wrapped(value, size, weight, width)) {
      await room(size * 1.4);
      draw(line, x, y + size, size, weight);
      y += size * 1.4;
    }
  }
  async function heading(value: string, following = 80) {
    section = value;
    await room(50 + following, false);
    draw(value, margin, y + 32, 25, 650);
    y += 54;
  }
  const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    for (const group of purchase.groups) {
      check();
      currentDesign++;
      report(
        'design',
        adminMessage('exports:productionSheet.progress.designQuantities', {
          formattedDesignNumber: new Intl.NumberFormat(localization.formatLocale).format(currentDesign),
          formattedDesignCount: new Intl.NumberFormat(localization.formatLocale).format(purchase.groups.length),
        }),
      );
      productTitle =
        purchase.lines.find((line) => line.productId === group.productId)?.title ??
        localization.t('exports:productionSheet.pdf.customizedItem');
      title = localization.t('exports:productionSheet.designTitle', {
        formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(group.index + 1),
      });
      quantity = group.variants.reduce((sum, variant) => sum + BigInt(variant.quantity), 0n);
      designPage = 0;
      section = '';
      continuationDetail = '';
      newPage();
      // Retain arbitrarily long merchant text in the body; compact repeated page headers remain readable.
      if (compact(orderLabel, 42, 750, (contentWidth - 48) / 2) !== orderLabel) await paragraph(orderLabel, 22);
      if (compact(productTitle, 29, 650, productWidth) !== productTitle) await paragraph(productTitle, 25, 600);
      const variantName = (variantId: string) =>
        purchase.lines.find((line) => line.productId === group.productId && line.variantId === variantId)
          ?.variantTitle ?? localization.t('exports:productionSheet.pdf.variantUnavailable');
      await heading(localization.t('exports:productionSheet.pdf.garments'), 90);
      context.font = '650 24px system-ui, sans-serif';
      const quantityColumnWidth = Math.max(
        155,
        ...group.variants.map((variant) => context.measureText(String(variant.quantity)).width + 36),
      );
      const tableHeader = () => {
        context.fillStyle = '#f3f5f6';
        context.fillRect(margin, y, contentWidth, 38);
        draw(localization.t('exports:productionSheet.pdf.garmentSize'), margin + 12, y + 26, 18, 500);
        draw(localization.t('exports:productionSheet.pdf.quantity'), pageWidth - margin - 56, y + 26, 18, 500);
        y += 44;
      };
      tableHeader();
      for (const variant of group.variants) {
        const lines = wrapped(variantName(variant.variantId), 22, 400, contentWidth - quantityColumnWidth);
        for (let index = 0; index < lines.length; index++) {
          if (await room(35)) tableHeader();
          draw(lines[index] ?? '', margin + 12, y + 23, 22);
          if (index === 0) {
            context.font = '650 24px system-ui, sans-serif';
            const count = String(variant.quantity);
            draw(count, pageWidth - margin - 12 - context.measureText(count).width, y + 23, 24, 650);
          }
          y += 32;
        }
        rule(y + 5);
        y += 14;
      }
      await room(48);
      draw(localization.t('exports:productionSheet.pdf.designTotal'), margin + 12, y + 25, 21, 650);
      context.font = '700 23px system-ui, sans-serif';
      const formattedQuantity = formatExactCount(quantity, localization.formatLocale).formatted;
      draw(formattedQuantity, pageWidth - margin - 12 - context.measureText(formattedQuantity).width, y + 25, 23, 700);
      y += 52;
      const artwork = new Map<string, { image: ImageBitmap; ratio: number }>();
      const geometry = geometries.get(group.index) ?? null;
      for (const [placementIndex, placement] of group.placements.entries()) {
        if (!productionArtworkAvailable(group, placement, preparedAt)) continue;
        const label =
          group.presentation?.labels.placements?.[placement.id] ??
          localization.t('exports:productionSheet.pdf.placementFallback', {
            formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(placementIndex + 1),
          });
        report(
          'artwork',
          adminMessage('exports:productionSheet.progress.designArtwork', {
            formattedDesignNumber: new Intl.NumberFormat(localization.formatLocale).format(currentDesign),
            formattedDesignCount: new Intl.NumberFormat(localization.formatLocale).format(purchase.groups.length),
            placementName: label,
          }),
        );
        try {
          const lease = PurchasePrivateUrlSchema.parse(
            await authenticatedJson(
              `/api/purchases/v1/${encodeURIComponent(purchase.purchaseId)}/artwork/${encodeURIComponent(placement.currentAssetId ?? '')}/preview`,
              { signal },
            ),
          );
          expiresAt = Math.min(expiresAt, Date.parse(lease.expiresAt), Date.parse(placement.currentExpiresAt ?? ''));
          check();
          const bitmap = await image(lease.url);
          check();
          artwork.set(placement.id, { image: bitmap, ratio: lease.aspectRatio ?? bitmap.width / bitmap.height });
        } catch (error) {
          check();
          if ([401, 403].includes((error as { status?: number }).status ?? 0)) throw error;
          throw new ProductionSheetError(
            'artworkLoadFailed',
            adminMessage('exports:productionSheet.errors.artworkLoadFailed', {
              designNumber: new Intl.NumberFormat(localization.formatLocale).format(currentDesign),
              placementName: label,
            }),
          );
        }
      }
      const views =
        geometry?.views.filter((view) =>
          view.placements.some((area) => group.placements.some((placement) => placement.id === area.id)),
        ) ?? [];
      // The same view can be shared only when both the image and effective placement rectangles match.
      const previews: { view: GeometryV1['views'][number]; variants: typeof group.variants }[] = [];
      for (const view of views) {
        const batches = new Map<string, typeof group.variants>();
        for (const variant of group.variants) {
          const imageRef =
            view.variantImages.find((entry) => entry.variantId === variant.variantId)?.image ?? view.image;
          const key = JSON.stringify([
            imageRef,
            view.placements.map((area) => [
              area.id,
              area.variantOverrides?.find((entry) => entry.variantId === variant.variantId)?.rect ?? area.rect,
            ]),
          ]);
          const batch = batches.get(key);
          if (batch) batch.push(variant);
          else batches.set(key, [variant]);
        }
        for (const variants of batches.values()) previews.push({ view, variants });
      }
      const detailsFor = (placement: (typeof group.placements)[number], index: number) => {
        const label =
          group.presentation?.labels.placements?.[placement.id] ??
          localization.t('exports:productionSheet.pdf.placementFallback', {
            formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(index + 1),
          });
        const method =
          group.presentation?.labels.methods?.[placement.methodId] ??
          localization.t('exports:productionSheet.pdf.methodUnavailable');
        const step =
          group.presentation?.labels.steps?.[placement.stepId] ??
          localization.t('exports:productionSheet.pdf.sizeUnavailable');
        const physical = geometry?.steps.find((entry) => entry.id === placement.stepId)?.physicalMm;
        return [
          { value: label, size: 24, weight: 650 },
          {
            value: localization.t('exports:productionSheet.pdf.methodName', { methodName: method }),
            size: 21,
            weight: 400,
          },
          {
            value: localization.t('exports:productionSheet.pdf.decorationSize', { sizeName: step }),
            size: 21,
            weight: 400,
          },
          {
            value: physical
              ? localization.t('exports:productionSheet.pdf.configuredSize', {
                  width: new Intl.NumberFormat(localization.formatLocale).format(physical.width),
                  height: new Intl.NumberFormat(localization.formatLocale).format(physical.height),
                })
              : localization.t('exports:productionSheet.pdf.physicalSizeUnconfigured'),
            size: 20,
            weight: 400,
          },
          ...(!artwork.has(placement.id)
            ? [{ value: localization.t('exports:productionSheet.pdf.artworkNeeded'), size: 21, weight: 650 }]
            : []),
        ];
      };
      const artworkCaptionFor = (placement: (typeof group.placements)[number]) => {
        if (artwork.has(placement.id)) {
          const number = placement.currentAssetId ? artworkNumbers.get(placement.currentAssetId) : undefined;
          return {
            lines: wrapped(
              localization.t('exports:productionSheet.pdf.artworkReference', {
                formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(number ?? 0),
              }),
              18,
              500,
              124,
            ),
            xOffset: 0,
            baselineOffset: 165,
            lineHeight: 18 * 1.4,
            size: 18,
            weight: 500,
          };
        }
        return {
          lines: wrapped(localization.t('exports:productionSheet.pdf.missingArtwork'), 20, 600, 104),
          xOffset: 20,
          baselineOffset: 99,
          lineHeight: 20 * 1.4,
          size: 20,
          weight: 600,
        };
      };
      const instructionRowHeight = (
        placement: (typeof group.placements)[number],
        index: number,
        detailWidth: number,
      ) => {
        const detailHeight = detailsFor(placement, index).reduce(
          (height, detail) =>
            height + wrapped(detail.value, detail.size, detail.weight, detailWidth).length * detail.size * 1.4,
          0,
        );
        const caption = artworkCaptionFor(placement);
        const captionExtra = artwork.has(placement.id) ? (caption.lines.length - 1) * caption.lineHeight : 0;
        return Math.max(180, detailHeight + 28, 180 + captionExtra);
      };
      // Keep each proof and its production facts together, using the same P reference on both.
      const instruction = async (
        placement: (typeof group.placements)[number],
        index: number,
        x: number,
        width: number,
      ) => {
        const current = artwork.get(placement.id);
        const details = detailsFor(placement, index);
        const caption = artworkCaptionFor(placement);
        const captionExtra = current ? (caption.lines.length - 1) * caption.lineHeight : 0;
        continuationDetail = `P${index + 1} / ${
          details[0]?.value ??
          localization.t('exports:productionSheet.pdf.placementFallback', {
            formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(index + 1),
          })
        }`;
        const textWidth = width - 156;
        const detailHeight = details.reduce(
          (sum, detail) =>
            sum + wrapped(detail.value, detail.size, detail.weight, textWidth).length * detail.size * 1.4,
          0,
        );
        const beside = detailHeight < 700;
        await room(
          beside ? Math.max(instructionRowHeight(placement, index, textWidth), 180 + captionExtra) : 184 + captionExtra,
        );
        const startY = y;
        badge(`P${index + 1}`, x, startY, index);
        const thumbnailY = startY + 45;
        context.fillStyle = '#a8a8a8';
        context.fillRect(x, thumbnailY, 124, 94);
        if (current) {
          const imageWidth = Math.min(108, 78 * current.ratio);
          const imageHeight = imageWidth / current.ratio;
          context.drawImage(
            current.image,
            x + (124 - imageWidth) / 2,
            thumbnailY + (94 - imageHeight) / 2,
            imageWidth,
            imageHeight,
          );
          caption.lines.forEach((line, lineIndex) => {
            draw(
              line,
              x + caption.xOffset,
              startY + caption.baselineOffset + lineIndex * caption.lineHeight,
              caption.size,
              caption.weight,
              muted,
            );
          });
        } else {
          const firstBaseline = thumbnailY + 54 - ((caption.lines.length - 1) * caption.lineHeight) / 2;
          caption.lines.forEach((line, lineIndex) => {
            draw(
              line,
              x + caption.xOffset,
              firstBaseline + lineIndex * caption.lineHeight,
              caption.size,
              caption.weight,
            );
          });
        }
        if (!beside) y += 190 + captionExtra;
        for (const detail of details)
          await paragraph(detail.value, detail.size, detail.weight, beside ? textWidth : width, beside ? x + 156 : x);
        y = (beside ? Math.max(y, startY + 170 + captionExtra) : y) + 24;
        continuationDetail = '';
      };
      if (geometry && previews.length) {
        const proofWidth = 454;
        const detailX = margin + proofWidth + 44;
        const detailWidth = contentWidth - proofWidth - 44;
        for (const { view, variants } of previews) {
          const variant = variants[0];
          if (!variant) continue;
          const placements = group.placements
            .map((placement, index) => ({ placement, index }))
            .filter(({ placement }) => view.placements.some((area) => area.id === placement.id));
          const viewName =
            group.presentation?.labels.views?.[view.id] ??
            localization.t('exports:productionSheet.pdf.garmentViewFallback');
          const detailHeight = placements.reduce(
            (sum, { placement, index }) => sum + instructionRowHeight(placement, index, detailWidth - 156),
            0,
          );
          // Long labels get the full page width and may continue naturally. Ordinary sections
          // stay whole, with enough image area to judge the placement.
          const beside = detailHeight <= 900;
          const imageHeight = previews.length >= 3 ? Math.min(390, Math.max(280, detailHeight)) : 340;
          section = viewName;
          continuationDetail = '';
          await room(44 + (beside ? Math.max(imageHeight, detailHeight) : imageHeight), false);
          draw(viewName, margin, y + 29, 24, 650);
          y += 44;
          if (variants.length !== group.variants.length) {
            await paragraph(variants.map((entry) => variantName(entry.variantId)).join(' / '), 20, 400);
            await room(beside ? Math.max(imageHeight, detailHeight) : imageHeight);
          }
          const startY = y;
          const imageRef =
            view.variantImages.find((entry) => entry.variantId === variant.variantId)?.image ?? view.image;
          const url = imageRef ? group.imageUrls[imageRef.revisionId] : undefined;
          report(
            'garment',
            adminMessage('exports:productionSheet.progress.designGarmentPreview', {
              formattedDesignNumber: new Intl.NumberFormat(localization.formatLocale).format(currentDesign),
              formattedDesignCount: new Intl.NumberFormat(localization.formatLocale).format(purchase.groups.length),
              viewName,
            }),
          );
          let background: ImageBitmap;
          try {
            if (!url)
              throw new ProductionSheetError(
                'garmentImageUnavailable',
                adminMessage('exports:productionSheet.errors.garmentImageUnavailable'),
              );
            background = await image(url);
          } catch {
            check();
            throw new ProductionSheetError(
              'garmentImageLoadFailed',
              adminMessage('exports:productionSheet.errors.garmentImageLoadFailed', {
                designNumber: new Intl.NumberFormat(localization.formatLocale).format(currentDesign),
                viewName,
              }),
            );
          }
          check();
          const viewport = { width: proofWidth, height: imageHeight, pixelRatio: 1 };
          const scene = projectScene(
            { version: 0, geometry, viewId: view.id, variantId: variant.variantId, artwork: { kind: 'none' } },
            viewport,
            group.imageUrls,
          );
          if (!scene.contentRect)
            throw new ProductionSheetError(
              'placementPreviewUnavailable',
              adminMessage('exports:productionSheet.errors.placementPreviewUnavailable'),
            );
          const rect = scene.contentRect;
          context.drawImage(background, margin + rect.x, startY + rect.y, rect.width, rect.height);
          // Tint the configured area before drawing artwork, so the original proof stays visible.
          for (const { placement, index } of placements) {
            const area = scene.placements.find((area) => area.id === placement.id)?.bounds;
            if (!area) continue;
            context.save();
            context.fillStyle = placementColor(index);
            context.globalAlpha = 0.1;
            context.fillRect(margin + area.x, startY + area.y, area.width, area.height);
            context.restore();
          }
          for (const { placement } of placements) {
            const current = artwork.get(placement.id);
            if (!current) continue;
            const decorated = projectScene(
              {
                version: 0,
                geometry,
                viewId: view.id,
                variantId: variant.variantId,
                selectedPlacementId: placement.id,
                selectedStepId: placement.stepId,
                ...(placement.position ? {artworkPosition:placement.position} : {}),
                artwork: { kind: 'raster', url: 'blob:worksheet', aspectRatio: current.ratio },
              },
              viewport,
              group.imageUrls,
            );
            if (decorated.artwork) {
              const rect = decorated.artwork.bounds;
              context.drawImage(current.image, margin + rect.x, startY + rect.y, rect.width, rect.height);
            }
          }
          const proofBadges: { x: number; y: number }[] = [];
          for (const { placement, index } of placements) {
            const area = scene.placements.find((area) => area.id === placement.id)?.bounds;
            if (!area) continue;
            const left = margin + area.x;
            const top = startY + area.y;
            context.save();
            context.lineWidth = 3;
            context.strokeStyle = '#fff';
            context.strokeRect(left, top, area.width, area.height);
            context.lineWidth = 2;
            context.strokeStyle = placementColor(index);
            context.setLineDash([2, 4]);
            context.strokeRect(left, top, area.width, area.height);
            context.restore();
            // Choose a free position beside the area's edge, without an arrow or a leader.
            const candidates = [
              { x: left, y: top - 36 },
              { x: left + area.width - 56, y: top - 36 },
              { x: left - 58, y: top },
              { x: left + area.width + 2, y: top },
              { x: left, y: top + area.height + 2 },
              { x: left + area.width - 56, y: top + area.height + 2 },
              ...[-60, 60, -120, 120].flatMap((offset) => [
                { x: left + offset, y: top - 36 },
                { x: left + offset, y: top + area.height + 2 },
              ]),
            ].map((candidate) => ({
              x: Math.max(margin, Math.min(margin + proofWidth - 56, candidate.x)),
              y: Math.max(startY, Math.min(startY + imageHeight - 34, candidate.y)),
            }));
            const position =
              candidates.find((candidate) =>
                proofBadges.every(
                  (badge) =>
                    candidate.x + 60 <= badge.x ||
                    badge.x + 60 <= candidate.x ||
                    candidate.y + 38 <= badge.y ||
                    badge.y + 38 <= candidate.y,
                ),
              ) ?? candidates[0];
            if (position) proofBadges.push(position);
          }
          // Paint references last, keeping them legible where the configured areas overlap.
          for (const [placementIndex, { index }] of placements.entries()) {
            const position = proofBadges[placementIndex];
            if (position) badge(`P${index + 1}`, position.x, position.y, index);
          }
          if (!beside) y += imageHeight + 28;
          for (const { placement, index } of placements)
            await instruction(placement, index, beside ? detailX : margin, beside ? detailWidth : contentWidth);
          y = Math.max(y, startY + imageHeight) + 18;
          await tick();
        }
      } else {
        await heading(localization.t('exports:productionSheet.pdf.decorationInstructions'), 80);
        await paragraph(localization.t('exports:productionSheet.pdf.garmentPlacementUnavailable'), 22);
        y += 20;
        for (const [index, placement] of group.placements.entries())
          await instruction(placement, index, margin, contentWidth);
      }
      await room(38, false);
      rule(y + 1, '#d9dfe3');
      draw(
        localization.t('exports:productionSheet.pdf.endOfDesign', {
          formattedNumber: new Intl.NumberFormat(localization.formatLocale).format(group.index + 1),
        }),
        margin,
        y + 29,
        18,
        500,
        muted,
      );
      await finish();
    }
    check();
    return {
      pages,
      expiresAt,
      hold,
      warnings,
      generatedAt,
      documentTitle: localization.t('exports:productionSheet.pdfTitle', { orderName: orderLabel }),
      dispose: () =>
        urls.forEach((url) => {
          URL.revokeObjectURL(url);
        }),
    };
  } catch (error) {
    urls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    throw error;
  } finally {
    images.forEach((bitmap) => {
      bitmap.close();
    });
  }
}

export async function productionSheetPdf(
  sheet: ProductionSheetResult,
  order: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const { PDFDocument } = await import('pdf-lib');
  signal?.throwIfAborted();
  const pdf = await PDFDocument.create();
  pdf.setTitle(sheet.documentTitle ?? `${order} · Production sheet`);
  pdf.setCreationDate(new Date(sheet.generatedAt));
  const yieldToBrowser = async () => {
    signal?.throwIfAborted();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  };
  for (const page of sheet.pages) {
    await yieldToBrowser();
    const image = await pdf.embedPng(page.png);
    signal?.throwIfAborted();
    pdf.addPage([595.28, 841.89]).drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
    // Compress and release this PNG's decoded channels before loading the next page.
    await image.embed();
    signal?.throwIfAborted();
  }
  await yieldToBrowser();
  const bytes = await pdf.save();
  signal?.throwIfAborted();
  return new Uint8Array(bytes);
}
