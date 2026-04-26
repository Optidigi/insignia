/**
 * Placement Edit Page
 *
 * Edit placement definition: name, base price, and price tiers.
 * Print area size is determined by the placement zone geometry in the view editor.
 */

import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
  redirect,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  Modal,
  BlockStack,
  Text,
  InlineStack,
  Checkbox,
  Divider,
  Box,
  Select,
  Badge,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  updatePlacement,
  deletePlacement,
  UpdatePlacementSchema,
} from "../lib/services/placements.server";
import { handleError, validateOrThrow, AppError, ErrorCodes } from "../lib/errors.server";
import { currencySymbol } from "../lib/services/shop-currency.server";
// design-fees:
import { designFeesEnabled } from "../lib/services/design-fees/feature-flag.server";
import { setPlacementCategory } from "../lib/services/design-fees/categories.server";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id: configId, placementId } = params;

  if (!configId || !placementId) {
    throw new Response("Config ID and placement ID required", { status: 400 });
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const currency = currencySymbol(shop.currencyCode);

  try {
    // Resolve placement directly via productConfig — getPlacement() takes
    // productViewId as its 2nd arg, but the URL gives us productConfigId.
    // This route's URL pattern (/products/:configId/placements/:placementId)
    // doesn't carry the viewId, so we look up the placement scoped to the
    // shop AND to any view inside the given config.
    const placementRow = await db.placementDefinition.findFirst({
      where: {
        id: placementId,
        productView: {
          productConfigId: configId,
          productConfig: { shopId: shop.id },
        },
      },
      include: { steps: { orderBy: { displayOrder: "asc" } } },
    });
    if (!placementRow) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Placement not found", 404);
    }
    const placement = placementRow;
    // design-fees: load categories whose method is enabled on this product config
    const designFeesOn = designFeesEnabled();
    let designFeeCategories: Array<{
      id: string;
      methodId: string;
      methodName: string;
      name: string;
      feeCents: number;
    }> = [];
    let placementFeeCategoryId: string | null = null;
    if (designFeesOn) {
      const config = await db.productConfig.findFirst({
        where: { id: configId, shopId: shop.id },
        select: { allowedMethods: { select: { decorationMethodId: true } } },
      });
      const methodIds = config?.allowedMethods.map((m) => m.decorationMethodId) ?? [];
      if (methodIds.length > 0) {
        const cats = await db.designFeeCategory.findMany({
          where: { shopId: shop.id, methodId: { in: methodIds } },
          orderBy: [{ methodId: "asc" }, { displayOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            methodId: true,
            name: true,
            feeCents: true,
            decorationMethod: { select: { name: true } },
          },
        });
        designFeeCategories = cats.map((c) => ({
          id: c.id,
          methodId: c.methodId,
          methodName: c.decorationMethod.name,
          name: c.name,
          feeCents: c.feeCents,
        }));
      }
      const pd = await db.placementDefinition.findUnique({
        where: { id: placementId },
        select: { feeCategoryId: true },
      });
      placementFeeCategoryId = pd?.feeCategoryId ?? null;
    }
    return {
      configId,
      placement,
      shopId: shop.id,
      currency,
      // design-fees:
      designFeesOn,
      designFeeCategories,
      placementFeeCategoryId,
    };
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      throw new Response("Placement not found", { status: 404 });
    }
    throw err;
  }
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const { id: configId, placementId } = params;

    if (!configId || !placementId) {
      throw new Response("Config ID and placement ID required", {
        status: 400,
      });
    }

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    // Resolve productViewId from the placement (URL only carries configId).
    // Same pre-existing arg-misalignment as the loader: updatePlacement /
    // deletePlacement take productViewId as their 2nd arg.
    const placementForView = await db.placementDefinition.findFirst({
      where: {
        id: placementId,
        productView: {
          productConfigId: configId,
          productConfig: { shopId: shop.id },
        },
      },
      select: { productViewId: true },
    });
    if (!placementForView) {
      throw new Response("Placement not found", { status: 404 });
    }
    const productViewId = placementForView.productViewId;

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "delete") {
      await deletePlacement(shop.id, productViewId, placementId);
      return redirect(`/app/products/${configId}`);
    }

    const name = formData.get("name") as string;
    const basePriceAdjustmentEuros = formData.get("basePriceAdjustmentEuros") as string;
    const basePriceAdjustmentCents = Math.round(
      (parseFloat(basePriceAdjustmentEuros || "0") || 0) * 100
    );
    const hidePriceWhenZero = formData.get("hidePriceWhenZero") === "true";
    const defaultStepIndex = parseInt(
      formData.get("defaultStepIndex") as string,
      10
    );
    const stepsJson = formData.get("steps") as string;
    const steps = stepsJson ? JSON.parse(stepsJson) : [];

    const input = validateOrThrow(
      UpdatePlacementSchema,
      {
        name,
        basePriceAdjustmentCents,
        hidePriceWhenZero,
        defaultStepIndex: Number.isNaN(defaultStepIndex) ? 0 : defaultStepIndex,
        steps,
      },
      "Invalid placement data"
    );

    await updatePlacement(shop.id, productViewId, placementId, input);
    // design-fees: feeCategoryId is optional; "" means clear; absent = no change.
    if (designFeesEnabled()) {
      const raw = formData.get("feeCategoryId");
      if (raw !== null) {
        const value = String(raw);
        await setPlacementCategory(shop.id, placementId, value === "" ? null : value);
      }
    }
    return { success: true };
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Component
// ============================================================================

type PriceTier = {
  id: string;
  label: string;
  priceAdjustmentCents: number;
};

export default function PlacementEditPage() {
  const {
    configId,
    placement,
    currency,
    // design-fees:
    designFeesOn,
    designFeeCategories,
    placementFeeCategoryId,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  useEffect(() => {
    if (actionData && "success" in actionData) {
      window.shopify?.toast?.show("Print area saved");
    }
  }, [actionData]);

  const [name, setName] = useState(placement.name);
  const [basePriceAmount, setBasePriceEuros] = useState(
    (placement.basePriceAdjustmentCents / 100).toFixed(2)
  );
  const [hidePriceWhenZero, setHidePriceWhenZero] = useState(
    placement.hidePriceWhenZero
  );
  const [defaultStepIndex, setDefaultStepIndex] = useState(
    placement.defaultStepIndex
  );
  // design-fees: per-placement fee category mapping (null = no fee)
  const [feeCategoryId, setFeeCategoryId] = useState<string | null>(
    placementFeeCategoryId ?? null,
  );
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>(
    placement.steps.length > 0
      ? placement.steps.map((s) => ({
          id: s.id,
          label: s.label,
          priceAdjustmentCents: s.priceAdjustmentCents,
        }))
      : [{ id: "new-0", label: "", priceAdjustmentCents: 0 }]
  );
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = navigation.state === "submitting";

  const addPriceTier = useCallback(() => {
    setPriceTiers((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        label: "",
        priceAdjustmentCents: 0,
      },
    ]);
  }, []);

  const removePriceTier = useCallback((index: number) => {
    setPriceTiers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        return [{ id: "new-0", label: "", priceAdjustmentCents: 0 }];
      }
      setDefaultStepIndex((d: number) => Math.min(d, next.length - 1));
      return next;
    });
  }, []);

  const updatePriceTier = useCallback(
    (index: number, field: keyof Omit<PriceTier, "id">, value: string | number) => {
      setPriceTiers((prev) =>
        prev.map((s, i) =>
          i === index ? { ...s, [field]: value } : s
        )
      );
    },
    []
  );

  const hasChanges =
    name !== placement.name ||
    Math.round((parseFloat(basePriceAmount) || 0) * 100) !== placement.basePriceAdjustmentCents ||
    hidePriceWhenZero !== placement.hidePriceWhenZero ||
    defaultStepIndex !== placement.defaultStepIndex ||
    // design-fees: include in change detection
    (designFeesOn && (feeCategoryId ?? null) !== (placementFeeCategoryId ?? null)) ||
    JSON.stringify(priceTiers.map((s) => ({ label: s.label, priceAdjustmentCents: s.priceAdjustmentCents }))) !==
      JSON.stringify(
        placement.steps.map((s: { label: string; priceAdjustmentCents: number }) => ({
          label: s.label,
          priceAdjustmentCents: s.priceAdjustmentCents,
        }))
      );

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    const stepValues = priceTiers
      .filter((s) => s.label.trim() !== "")
      .map((s) => ({
        label: s.label.trim(),
        priceAdjustmentCents: Number(s.priceAdjustmentCents) || 0,
        scaleFactor: 1.0,
      }));
    if (stepValues.length === 0) {
      setError("At least one price tier with a label is required");
      return;
    }
    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("name", name.trim());
    formData.append(
      "basePriceAdjustmentEuros",
      String(parseFloat(basePriceAmount) || 0)
    );
    formData.append("hidePriceWhenZero", String(hidePriceWhenZero));
    formData.append("defaultStepIndex", String(Math.min(defaultStepIndex, stepValues.length - 1)));
    formData.append("steps", JSON.stringify(stepValues));
    // design-fees: persist mapping (only when feature is on)
    if (designFeesOn) {
      formData.append("feeCategoryId", feeCategoryId ?? "");
    }
    submit(formData, { method: "POST" });
    setError(null);
  }, [
    name,
    basePriceAmount,
    hidePriceWhenZero,
    defaultStepIndex,
    priceTiers,
    submit,
    // design-fees:
    designFeesOn,
    feeCategoryId,
  ]);

  const handleDelete = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "delete");
    submit(formData, { method: "POST" });
    setDeleteModalOpen(false);
  }, [submit]);

  const defaultTierOptions = priceTiers
    .map((s, i) => ({
      label: s.label.trim() || `Tier ${i + 1}`,
      value: String(i),
    }));

  return (
    <Page
      title={placement.name}
      subtitle="Print area settings and pricing"
      backAction={{
        content: "Products",
        url: `/app/products/${configId}`,
      }}
      primaryAction={{
        content: "Save",
        disabled: !hasChanges,
        loading: isSubmitting,
        onAction: handleSave,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                <p>{error}</p>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text variant="headingSm" as="h2">
                  Placement settings
                </Text>
                <FormLayout>
                  <TextField
                    label="Name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    helpText="Shown to customers, e.g. Left chest, Full back"
                  />
                  <FormLayout.Group>
                    <TextField
                      label="Base price"
                      type="number"
                      prefix={currency}
                      value={basePriceAmount}
                      onChange={setBasePriceEuros}
                      autoComplete="off"
                      helpText="Charge for using this placement area"
                    />
                    <Select
                      label="Default tier"
                      options={defaultTierOptions}
                      value={String(defaultStepIndex)}
                      onChange={(v) => setDefaultStepIndex(parseInt(v, 10) || 0)}
                      helpText="Pre-selected when a customer picks this placement"
                    />
                  </FormLayout.Group>
                  <Checkbox
                    label="Hide price when zero"
                    checked={hidePriceWhenZero}
                    onChange={setHidePriceWhenZero}
                  />
                  {/* design-fees: per-placement category mapping */}
                  {designFeesOn && (
                    <Select
                      label="Design fee category"
                      options={[
                        { label: "No design fee for this placement", value: "" },
                        ...designFeeCategories.map((c) => ({
                          label: `${c.methodName} – ${c.name} (${currency}${(c.feeCents / 100).toFixed(2)})`,
                          value: c.id,
                        })),
                      ]}
                      value={feeCategoryId ?? ""}
                      onChange={(v) => setFeeCategoryId(v === "" ? null : v)}
                      helpText="Charged once per cart per (logo × this category × method) when this placement is selected."
                    />
                  )}
                </FormLayout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="headingSm" as="h2">
                      Price tiers
                    </Text>
                    <Text tone="subdued" as="p" variant="bodySm">
                      Each tier is an option customers can choose. The print area
                      size is set in the view editor using the placement zone tool.
                    </Text>
                  </BlockStack>
                  <Button onClick={addPriceTier}>Add tier</Button>
                </InlineStack>

                <Divider />

                {priceTiers.map((tier, index) => (
                  <Box
                    key={tier.id}
                    padding="400"
                    borderWidth="025"
                    borderColor="border"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="headingSm" as="h3">
                            {tier.label.trim() || `Tier ${index + 1}`}
                          </Text>
                          {index === defaultStepIndex && (
                            <Badge tone="info">Default</Badge>
                          )}
                        </InlineStack>
                        <Button
                          tone="critical"
                          variant="plain"
                          onClick={() => removePriceTier(index)}
                          accessibilityLabel={`Remove ${tier.label || "tier"}`}
                          icon={DeleteIcon}
                          disabled={priceTiers.length === 1}
                        />
                      </InlineStack>

                      <FormLayout>
                        <FormLayout.Group>
                          <TextField
                            label="Label"
                            value={tier.label}
                            onChange={(v) => updatePriceTier(index, "label", v)}
                            autoComplete="off"
                            placeholder="e.g. Standard, Premium"
                          />
                          <TextField
                            label="Price adjustment"
                            type="number"
                            prefix={currency}
                            value={(tier.priceAdjustmentCents / 100).toFixed(2)}
                            onChange={(v) =>
                              updatePriceTier(
                                index,
                                "priceAdjustmentCents",
                                Math.round((parseFloat(v || "0") || 0) * 100)
                              )
                            }
                            autoComplete="off"
                            helpText="Added on top of the base price"
                          />
                        </FormLayout.Group>
                      </FormLayout>
                    </BlockStack>
                  </Box>
                ))}

                {priceTiers.length === 0 && (
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text tone="subdued" as="p">
                        No price tiers yet. Add at least one for customers to choose from.
                      </Text>
                      <Button onClick={addPriceTier}>Add price tier</Button>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingSm" as="h2">
                Delete placement
              </Text>
              <Text tone="subdued" as="p">
                Permanently remove this placement and its price tiers.
                Geometry saved on views for this placement will also be removed.
              </Text>
              <Button tone="critical" onClick={() => setDeleteModalOpen(true)}>
                Delete placement
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete placement?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDelete,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete &quot;{placement.name}&quot;? This action
            cannot be undone and will remove all price tiers and view geometry.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
