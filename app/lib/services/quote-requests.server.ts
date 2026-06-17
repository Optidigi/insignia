import { z } from "zod";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

export const QuoteRequestInputSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  productConfigId: z.string().uuid(),
  logoAssetId: z.string().uuid().nullable().optional(),
  artworkStatus: z.enum(["PROVIDED", "PENDING_CUSTOMER"]),
  decorationChoice: z.enum(["print", "embroidery", "advise"]),
  maxFormatChoice: z.enum(["10cm", "20cm", "30cm", "other"]),
  maxFormatCustom: z.string().max(120).nullable().optional(),
  placementWish: z.string().min(1).max(2000),
  notes: z.string().max(2000).nullable().optional(),
  contactName: z.string().min(1).max(200),
  contactEmail: z.string().email().max(320),
  contactPhone: z.string().max(80).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  productSnapshot: z.object({
    productTitle: z.string().max(500),
    variantTitle: z.string().max(500).nullable().optional(),
    methodLabel: z.string().max(200).nullable().optional(),
    maxFormatLabel: z.string().max(200).nullable().optional(),
    imageUrl: z.string().url().nullable().optional(),
  }),
});

export type QuoteRequestInput = z.infer<typeof QuoteRequestInputSchema>;

export async function createQuoteRequest(shopId: string, input: QuoteRequestInput) {
  const config = await db.productConfig.findFirst({
    where: { id: input.productConfigId, shopId },
    include: {
      allowedMethods: { include: { decorationMethod: true } },
    },
  });

  if (!config) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Product configuration not found", 404);
  }
  if (config.storefrontMode !== "quote_request") {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Product configuration is not in quote request mode", 400);
  }
  if (!config.linkedProductIds.includes(input.productId)) {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Product not linked to this configuration", 400);
  }

  if (input.decorationChoice !== "advise") {
    const expectedMethod = input.decorationChoice === "print" ? "bedruk" : "bordur";
    const hasMethod = config.allowedMethods.some((row) => {
      const label = `${row.decorationMethod.name} ${row.decorationMethod.customerName ?? ""}`.toLowerCase();
      return label.includes(expectedMethod);
    });
    if (!hasMethod) {
      throw new AppError(ErrorCodes.BAD_REQUEST, "Selected decoration method is not available for this product", 400);
    }
  }

  if (input.maxFormatChoice === "other" && !input.maxFormatCustom?.trim()) {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Custom max format is required", 400);
  }

  const quoteRequest = await db.quoteRequest.create({
    data: {
      shopId,
      productId: input.productId,
      variantId: input.variantId,
      productConfigId: input.productConfigId,
      logoAssetId: input.logoAssetId ?? null,
      artworkStatus: input.artworkStatus,
      decorationChoice: input.decorationChoice,
      maxFormatChoice: input.maxFormatChoice,
      maxFormatCustom: input.maxFormatCustom?.trim() || null,
      placementWish: input.placementWish.trim(),
      notes: input.notes?.trim() || null,
      contactName: input.contactName.trim(),
      contactEmail: input.contactEmail.trim(),
      contactPhone: input.contactPhone?.trim() || null,
      companyName: input.companyName?.trim() || null,
      productSnapshot: input.productSnapshot,
    },
    select: { id: true },
  });

  return { quoteRequestId: quoteRequest.id };
}
