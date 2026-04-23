/**
 * Decoration Methods List Page
 * 
 * Displays all decoration methods and allows creating new ones.
 */

import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  Modal,
  FormLayout,
  TextField,
  Banner,
  EmptyState,
  IndexTable,
  Badge,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createMethod, CreateMethodSchema } from "../lib/services/methods.server";
import { provisionVariantPool } from "../lib/services/variant-pool.server";
import { handleError, validateOrThrow } from "../lib/errors.server";
import { currencySymbol } from "../lib/services/shop-currency.server";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get or create shop record
  let shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true, currencyCode: true },
  });

  if (!shop) {
    shop = await db.shop.create({
      data: {
        shopifyDomain: session.shop,
        accessToken: session.accessToken || "",
      },
      select: { id: true, currencyCode: true },
    });
  }

  const methods = await db.decorationMethod.findMany({
    where: { shopId: shop.id },
    include: {
      _count: { select: { productConfigs: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { methods, shopId: shop.id, currency: currencySymbol(shop.currencyCode) };
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    
    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const basePriceCentsRaw = formData.get("basePriceCents");
    const basePriceCents = basePriceCentsRaw ? parseInt(String(basePriceCentsRaw), 10) : 0;

    const input = validateOrThrow(CreateMethodSchema, { name, basePriceCents }, "Invalid method data");
    const method = await createMethod(shop.id, input);

    // Auto-provision variant pool slots for the new method
    try {
      const runGraphql = async (query: string, variables?: Record<string, unknown>) => {
        const response = await admin.graphql(query, { variables } as Record<string, unknown>);
        return response as Response;
      };
      await provisionVariantPool(shop.id, method.id, method.name, runGraphql);
    } catch (provisionError) {
      console.error("[methods] Failed to auto-provision variant pool:", provisionError);
    }

    return { method, success: true };
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Component
// ============================================================================

export default function MethodsPage() {
  const { methods, currency } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const [modalOpen, setModalOpen] = useState(false);
  const [newMethodName, setNewMethodName] = useState("");
  const [newMethodPrice, setNewMethodPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Track the optimistic method name while submitting
  const [optimisticName, setOptimisticName] = useState<string | null>(null);

  const isSubmitting = fetcher.state === "submitting";

  // Fire toast immediately when fetcher transitions from submitting → idle with success
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "success" in fetcher.data) {
      window.shopify?.toast?.show("Method created");
      setOptimisticName(null);
    }
  }, [fetcher.state, fetcher.data]);

  const handleCreateMethod = useCallback(() => {
    if (!newMethodName.trim()) {
      setError("Name is required");
      return;
    }

    const trimmedName = newMethodName.trim();
    const priceInput = newMethodPrice.trim();
    const cents = priceInput === "" ? 0 : Math.round(parseFloat(priceInput) * 100);
    const safeCents = Number.isFinite(cents) && cents >= 0 ? cents : 0;

    const formData = new FormData();
    formData.append("name", trimmedName);
    formData.append("basePriceCents", String(safeCents));

    // Store the name for optimistic rendering
    setOptimisticName(trimmedName);

    fetcher.submit(formData, { method: "POST" });
    setModalOpen(false);
    setNewMethodName("");
    setNewMethodPrice("");
    setError(null);
  }, [newMethodName, newMethodPrice, fetcher]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setNewMethodName("");
    setNewMethodPrice("");
    setError(null);
  }, []);

  return (
    <Page
      title="Decoration Methods"
      subtitle="Define how logos are applied to products"
      primaryAction={{
        content: "Add Method",
        onAction: () => setModalOpen(true),
      }}
    >
      <Layout>
        <Layout.Section>
          {methods.length === 0 && !isSubmitting ? (
            <Card>
              <EmptyState
                heading="Create a decoration method"
                action={{ content: "Add method", onAction: () => setModalOpen(true) }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Decoration methods define how logos are applied (embroidery, screen print, DTG, etc.) and their base pricing.</p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={{
                  singular: "method",
                  plural: "methods",
                }}
                itemCount={methods.length + (isSubmitting ? 1 : 0)}
                headings={[
                  { title: "Name" },
                  { title: "Products" },
                  { title: "Created", alignment: "end" },
                ]}
                selectable={false}
                hasZebraStriping
              >
                {methods.map((method, index) => (
                  <IndexTable.Row
                    key={method.id}
                    id={method.id}
                    position={index}
                    onNavigation={(id) => navigate(`/app/methods/${id}`)}
                  >
                    <IndexTable.Cell>
                      <Link
                        to={`/app/methods/${method.id}`}
                        data-primary-link
                        style={{ color: "inherit", textDecoration: "none" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Text variant="bodyMd" fontWeight="bold" as="span">
                          {method.name}
                        </Text>
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={method._count.productConfigs > 0 ? "info" : undefined}>
                        {`${method._count.productConfigs} ${method._count.productConfigs === 1 ? "product" : "products"}`}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" tone="subdued" as="span" alignment="end" numeric>
                        {new Date(method.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
                {/* Optimistic ghost row — visible while the create request is in flight */}
                {isSubmitting && optimisticName && (
                  <IndexTable.Row
                    key="__optimistic__"
                    id="__optimistic__"
                    position={methods.length}
                  >
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="bold" as="span" tone="subdued">
                        {optimisticName}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge>0 products</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text variant="bodySm" tone="subdued" as="span" alignment="end" numeric>
                        Saving…
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                )}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={modalOpen}
        onClose={handleModalClose}
        title="Add Decoration Method"
        primaryAction={{
          content: "Create",
          onAction: handleCreateMethod,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleModalClose,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {error && (
              <Banner tone="critical">
                <p>{error}</p>
              </Banner>
            )}
            <TextField
              label="Method Name"
              value={newMethodName}
              onChange={setNewMethodName}
              autoComplete="off"
              placeholder="e.g., Embroidery, DTG, Screen Print"
              helpText="This name will be visible to your customers"
            />
            <TextField
              label="Base price"
              type="number"
              value={newMethodPrice}
              onChange={setNewMethodPrice}
              prefix={currency}
              autoComplete="off"
              helpText="Decoration fee added to every order (0 = free)"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
