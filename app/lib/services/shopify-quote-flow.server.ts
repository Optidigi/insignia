import type { QuoteRequestInput } from "./quote-requests.server";

const METAOBJECT_TYPE = "$app:quote_request";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type GraphqlError = {
  field?: string[] | null;
  message: string;
  code?: string | null;
};

async function graphql<T>(
  admin: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as T & { errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  return body;
}

function assertNoUserErrors(errors: GraphqlError[] | undefined, context: string) {
  if (errors?.length) {
    throw new Error(`${context}: ${JSON.stringify(errors)}`);
  }
}

async function ensureQuoteRequestDefinition(admin: AdminGraphql) {
  const existing = await graphql<{
    data?: { metaobjectDefinitionByType?: { id: string } | null };
  }>(
    admin,
    `#graphql
      query QuoteRequestDefinition($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
        }
      }
    `,
    { type: METAOBJECT_TYPE },
  );

  if (existing.data?.metaobjectDefinitionByType?.id) {
    return existing.data.metaobjectDefinitionByType;
  }

  const created = await graphql<{
    data?: {
      metaobjectDefinitionCreate: {
        metaobjectDefinition?: { id: string } | null;
        userErrors: GraphqlError[];
      };
    };
  }>(
    admin,
    `#graphql
      mutation CreateQuoteRequestDefinition($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition {
            id
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    {
      definition: {
        type: METAOBJECT_TYPE,
        name: "Insignia offerteaanvraag",
        description: "Quote requests submitted from Insignia quote-form products.",
        displayNameKey: "summary",
        access: {
          admin: "MERCHANT_READ_WRITE",
          storefront: "NONE",
        },
        fieldDefinitions: [
          { key: "summary", name: "Samenvatting", type: "single_line_text_field", required: true },
          { key: "quote_request_id", name: "Insignia aanvraag-ID", type: "single_line_text_field", required: true },
          { key: "product_title", name: "Product", type: "single_line_text_field", required: true },
          { key: "variant_title", name: "Variant", type: "single_line_text_field" },
          { key: "total_quantity", name: "Totaal aantal", type: "single_line_text_field" },
          { key: "quantities", name: "Aantallen", type: "multi_line_text_field" },
          { key: "technique", name: "Techniek", type: "single_line_text_field" },
          { key: "max_format", name: "Maximaal formaat", type: "single_line_text_field" },
          { key: "placement_wish", name: "Plaatsingswens", type: "multi_line_text_field", required: true },
          { key: "notes", name: "Opmerkingen", type: "multi_line_text_field" },
          { key: "artwork_status", name: "Artwork", type: "single_line_text_field" },
          { key: "logo_url", name: "Artwork URL", type: "url" },
          { key: "product_image_url", name: "Productfoto URL", type: "url" },
          { key: "contact_name", name: "Naam", type: "single_line_text_field", required: true },
          { key: "contact_email", name: "E-mail", type: "single_line_text_field", required: true },
          { key: "contact_phone", name: "Telefoon", type: "single_line_text_field" },
          { key: "company_name", name: "Bedrijf", type: "single_line_text_field" },
          { key: "submitted_at", name: "Ingediend op", type: "single_line_text_field" },
        ],
      },
    },
  );

  const result = created.data?.metaobjectDefinitionCreate;
  assertNoUserErrors(result?.userErrors, "create quote request metaobject definition");
  if (!result?.metaobjectDefinition?.id) {
    throw new Error("create quote request metaobject definition: missing definition id");
  }
  return result.metaobjectDefinition;
}

function quantitySummary(input: QuoteRequestInput): string {
  const lines = input.productSnapshot.quantities ?? [];
  if (lines.length === 0) return "";
  return lines
    .map((line) => `${line.sizeLabel || line.variantTitle || "Variant"} x ${line.quantity}`)
    .join("\n");
}

function field(key: string, value: string | number | null | undefined) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized ? { key, value: normalized } : null;
}

export async function createQuoteRequestFlowMetaobject(
  admin: AdminGraphql,
  params: {
    quoteRequestId: string;
    input: QuoteRequestInput;
  },
) {
  await ensureQuoteRequestDefinition(admin);

  const { input, quoteRequestId } = params;
  const productTitle = input.productSnapshot.productTitle;
  const summary = `${productTitle} - ${input.contactName.trim()}`;
  const fields = [
    field("summary", summary),
    field("quote_request_id", quoteRequestId),
    field("product_title", productTitle),
    field("variant_title", input.productSnapshot.variantTitle),
    field("total_quantity", input.productSnapshot.totalQuantity),
    field("quantities", quantitySummary(input)),
    field("technique", input.productSnapshot.methodLabel),
    field("max_format", input.productSnapshot.maxFormatLabel),
    field("placement_wish", input.placementWish),
    field("notes", input.notes),
    field("artwork_status", input.artworkStatus === "PROVIDED" ? "Artwork geupload" : "Artwork later sturen"),
    field("logo_url", input.productSnapshot.logoUrl),
    field("product_image_url", input.productSnapshot.imageUrl),
    field("contact_name", input.contactName),
    field("contact_email", input.contactEmail),
    field("contact_phone", input.contactPhone),
    field("company_name", input.companyName),
    field("submitted_at", new Date().toISOString()),
  ].filter((value): value is { key: string; value: string } => value != null);

  const created = await graphql<{
    data?: {
      metaobjectCreate: {
        metaobject?: { id: string; handle: string } | null;
        userErrors: GraphqlError[];
      };
    };
  }>(
    admin,
    `#graphql
      mutation CreateQuoteRequestMetaobject($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            id
            handle
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    {
      metaobject: {
        type: METAOBJECT_TYPE,
        handle: `quote-${quoteRequestId}`,
        fields,
      },
    },
  );

  const result = created.data?.metaobjectCreate;
  assertNoUserErrors(result?.userErrors, "create quote request metaobject");
  if (!result?.metaobject?.id) {
    throw new Error("create quote request metaobject: missing metaobject id");
  }
  return result.metaobject;
}
