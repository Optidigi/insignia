/**
 * Settings Page
 *
 * Merchant settings: theme integration, placeholder logo, and storefront translations.
 * Canonical: docs/core/api-contracts/admin.md
 */

import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Form, useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineStack,
  Box,
  Thumbnail,
  DropZone,
  Spinner,
  Tabs,
  Select,
  TextField,
} from "@shopify/polaris";
import { ExternalIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  getMerchantSettings,
  updateMerchantSettings,
  UpdateSettingsSchema,
} from "../lib/services/settings.server";
import { handleError, validateOrThrow } from "../lib/errors.server";

// ============================================================================
// Translation constants
// ============================================================================

const TRANSLATION_KEYS = [
  // Step 1 — Upload
  { key: "upload.title", label: "Upload step: Title", default: "Upload your logo" },
  { key: "upload.subtitle", label: "Upload step: Subtitle", default: "Drag & drop or click to upload" },
  { key: "upload.button", label: "Upload step: Continue button", default: "Continue" },
  { key: "upload.artwork_later", label: "Upload step: Skip artwork link", default: "I'll upload artwork later" },
  // Step 2 — Placement
  { key: "placement.title", label: "Placement step: Title", default: "Choose placement" },
  { key: "placement.button_next", label: "Placement step: Next button", default: "Continue" },
  { key: "placement.button_back", label: "Placement step: Back button", default: "Back" },
  // Step 3 — Size
  { key: "size.title", label: "Size step: Title", default: "Choose size" },
  { key: "size.button_next", label: "Size step: Next button", default: "Continue" },
  { key: "size.button_back", label: "Size step: Back button", default: "Back" },
  // Step 4 — Review
  { key: "review.title", label: "Review step: Title", default: "Review your customization" },
  { key: "review.button_add", label: "Review step: Add to cart button", default: "Add to cart" },
  { key: "review.button_back", label: "Review step: Back button", default: "Back" },
  // Common
  { key: "common.close", label: "Common: Close button", default: "Close" },
  { key: "common.loading", label: "Common: Loading text", default: "Loading\u2026" },
  { key: "common.method_label", label: "Common: Decoration method label", default: "Decoration method" },
] as const;

const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "nl", label: "Dutch (Nederlands)" },
  { code: "de", label: "German (Deutsch)" },
  { code: "fr", label: "French (Fran\u00e7ais)" },
  { code: "es", label: "Spanish (Espa\u00f1ol)" },
  { code: "it", label: "Italian (Italiano)" },
  { code: "pt", label: "Portuguese (Portugu\u00eas)" },
  { code: "pl", label: "Polish (Polski)" },
] as const;

const VALID_LOCALES = SUPPORTED_LOCALES.map((l) => l.code) as unknown as string[];

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const apiBaseUrl = url.origin;
  const sessionTokenForApi =
    url.searchParams.get("id_token") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: session.shop },
    select: { id: true },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const settings = await getMerchantSettings(shop.id);

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const shopDomain = session.shop;
  const themeEditorUrl =
    apiKey && shopDomain
      ? `https://${shopDomain}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/customize-button&target=mainSection`
      : null;

  // Load all translations for this shop (all locales)
  const translations = await db.storefrontTranslation.findMany({
    where: { shopId: shop.id },
    select: { locale: true, key: true, value: true },
  });
  // Shape: { [locale]: { [key]: value } }
  const translationMap: Record<string, Record<string, string>> = {};
  for (const t of translations) {
    if (!translationMap[t.locale]) translationMap[t.locale] = {};
    translationMap[t.locale][t.key] = t.value;
  }

  return {
    settings,
    apiBaseUrl,
    sessionTokenForApi,
    shopId: shop.id,
    themeEditorUrl,
    translationMap,
  };
};

// ============================================================================
// Action
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });

    if (!shop) {
      throw new Response("Shop not found", { status: 404 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "remove-placeholder") {
      await updateMerchantSettings(shop.id, {
        placeholderLogoImageUrl: null,
      });
      return { success: "Settings saved" };
    }

    if (intent === "save-placeholder") {
      const placeholderLogoImageUrl = formData.get(
        "placeholderLogoImageUrl"
      ) as string | null;
      const input = validateOrThrow(
        UpdateSettingsSchema,
        {
          placeholderLogoImageUrl: placeholderLogoImageUrl || null,
        },
        "Invalid settings"
      );
      await updateMerchantSettings(shop.id, input);
      return { success: "Settings saved" };
    }

    if (intent === "save-translations") {
      const locale = formData.get("locale") as string;
      if (!VALID_LOCALES.includes(locale)) return { error: "Invalid locale" };

      const keyDefs = TRANSLATION_KEYS.map((k) => k.key);
      await Promise.all(
        keyDefs.map(async (key) => {
          const rawValue = (formData.get(`t_${key}`) as string | null) ?? "";
          const value = rawValue.trim().slice(0, 500); // max 500 chars per translation value
          if (value) {
            await db.storefrontTranslation.upsert({
              where: { shopId_locale_key: { shopId: shop.id, locale, key } },
              create: { shopId: shop.id, locale, key, value },
              update: { value },
            });
          } else {
            // Delete override (revert to default)
            await db.storefrontTranslation.deleteMany({
              where: { shopId: shop.id, locale, key },
            });
          }
        })
      );
      return { success: "Translations saved" };
    }

    throw new Response("Invalid intent", { status: 400 });
  } catch (error) {
    return handleError(error);
  }
};

// ============================================================================
// Component
// ============================================================================

export default function SettingsPage() {
  const { settings, apiBaseUrl, sessionTokenForApi, themeEditorUrl, translationMap } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedTab, setSelectedTab] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLocale, setSelectedLocale] = useState("en");
  const [translationValues, setTranslationValues] = useState<Record<string, string>>(
    () => translationMap["en"] ?? {}
  );

  const isSubmitting = navigation.state === "submitting";

  const handleFileDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;

      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
      if (!allowedTypes.includes(file.type)) {
        setError("Please upload a JPEG, PNG, WebP, or SVG image");
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setError("Image must be less than 5MB");
        return;
      }

      setUploading(true);
      setError(null);

      try {
        const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1];
        const formData = new FormData();
        formData.append("intent", "placeholder-logo");
        formData.append("contentType", file.type);
        formData.append("fileName", `placeholder.${ext}`);

        const headers: HeadersInit = {};
        if (sessionTokenForApi) {
          headers.Authorization = `Bearer ${sessionTokenForApi}`;
        }
        const response = await fetch(`${apiBaseUrl}/api/admin/upload-url`, {
          method: "POST",
          body: formData,
          credentials: "include",
          headers,
        });

        const contentType = response.headers.get("Content-Type") ?? "";
        if (!contentType.includes("application/json")) {
          throw new Error(
            response.status === 401
              ? "Session expired. Please refresh the page."
              : "Server error. Please try again."
          );
        }

        const result = await response.json();
        if (result?.error?.message) {
          throw new Error(result.error.message);
        }
        if (!result.success || !result.uploadUrl) {
          throw new Error("Failed to get upload URL");
        }

        const publicUrl = result.publicUrl;
        if (!publicUrl) {
          setError(
            "Image storage is not configured. Please contact the app developer to set up image hosting."
          );
          setUploading(false);
          return;
        }

        const uploadResponse = await fetch(result.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });

        if (!uploadResponse.ok) {
          throw new Error("Failed to upload image");
        }

        const saveFormData = new FormData();
        saveFormData.append("intent", "save-placeholder");
        saveFormData.append("placeholderLogoImageUrl", publicUrl);
        submit(saveFormData, { method: "POST" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to upload image");
      } finally {
        setUploading(false);
      }
    },
    [apiBaseUrl, sessionTokenForApi, submit]
  );

  const handleRemovePlaceholder = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "remove-placeholder");
    submit(formData, { method: "POST" });
    setError(null);
  }, [submit]);

  useEffect(() => {
    if (navigation.state === "idle" && navigation.formData) {
      setError(null);
    }
  }, [navigation.state, navigation.formData]);

  const hasPlaceholder = Boolean(settings.placeholderLogoImageUrl);

  const tabs = [
    { id: "general", content: "General", panelID: "general-panel" },
    { id: "translations", content: "Translations", panelID: "translations-panel" },
  ];

  const handleLocaleChange = useCallback(
    (locale: string) => {
      setSelectedLocale(locale);
      setTranslationValues(translationMap[locale] ?? {});
    },
    [translationMap]
  );

  const translationActionResult = actionData as
    | { success: string; error?: never }
    | { error: string; success?: never }
    | { success?: never; error?: never }
    | null
    | undefined;

  return (
    <Page
      title="Settings"
      subtitle="Configure storefront appearance and defaults"
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
        {selectedTab === 0 && (
          <Layout>
            {error && (
              <Layout.Section>
                <Banner tone="critical" onDismiss={() => setError(null)}>
                  <p>{error}</p>
                </Banner>
              </Layout.Section>
            )}

            <Layout.AnnotatedSection
              title="Theme integration"
              description="Add the Insignia Customize button to your store's product pages."
            >
              <Card>
                <BlockStack gap="300">
                  <Banner tone="info">
                    <Text as="p">
                      Add the Customize button to your theme to let customers personalize products directly from product pages.
                    </Text>
                  </Banner>
                  {themeEditorUrl && (
                    <Button
                      icon={ExternalIcon}
                      onClick={() => window.open(themeEditorUrl, "_top")}
                    >
                      Open theme editor
                    </Button>
                  )}
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Placeholder logo"
              description={'When a customer chooses "Logo later" at checkout, a placeholder is shown on the product preview. Upload your own image or leave blank to show default "LOGO" text.'}
            >
              <Card>
                <BlockStack gap="400">
                  {hasPlaceholder ? (
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center" gap="400">
                        <Text as="p" fontWeight="semibold">
                          Current placeholder
                        </Text>
                        <Button
                          tone="critical"
                          variant="plain"
                          onClick={handleRemovePlaceholder}
                          disabled={isSubmitting}
                        >
                          Remove
                        </Button>
                      </InlineStack>
                      <Box paddingBlockStart="200">
                        <Thumbnail
                          source={settings.placeholderLogoImageUrl!}
                          alt="Placeholder logo"
                          size="large"
                        />
                      </Box>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Upload a new image to replace it.
                      </Text>
                    </BlockStack>
                  ) : null}

                  <DropZone
                    accept="image/jpeg,image/png,image/webp,image/svg+xml"
                    type="image"
                    onDrop={handleFileDrop}
                    disabled={uploading}
                  >
                    <DropZone.FileUpload
                      actionHint="Accepts JPEG, PNG, WebP, and SVG"
                      actionTitle="Upload image"
                    />
                    {uploading && (
                      <Box paddingBlockStart="200">
                        <Spinner size="small" />
                      </Box>
                    )}
                  </DropZone>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>
        )}

        {selectedTab === 1 && (
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                {translationActionResult?.success && (
                  <Banner tone="success">
                    <p>{translationActionResult.success}</p>
                  </Banner>
                )}
                {translationActionResult?.error && (
                  <Banner tone="critical">
                    <p>{translationActionResult.error}</p>
                  </Banner>
                )}

                <Form method="post">
                  <input type="hidden" name="intent" value="save-translations" />
                  <input type="hidden" name="locale" value={selectedLocale} />

                  <BlockStack gap="400">
                    <Select
                      label="Language"
                      options={SUPPORTED_LOCALES.map((l) => ({ label: l.label, value: l.code }))}
                      value={selectedLocale}
                      onChange={handleLocaleChange}
                    />

                    <Card>
                      <BlockStack gap="300">
                        {TRANSLATION_KEYS.map(({ key, label, default: defaultVal }) => (
                          <TextField
                            key={key}
                            name={`t_${key}`}
                            label={label}
                            placeholder={defaultVal}
                            value={translationValues[key] ?? ""}
                            onChange={(val) =>
                              setTranslationValues((prev) => ({ ...prev, [key]: val }))
                            }
                            helpText={`Default: "${defaultVal}"`}
                            autoComplete="off"
                          />
                        ))}
                      </BlockStack>
                    </Card>

                    <InlineStack align="end">
                      <Button submit variant="primary" loading={isSubmitting}>
                        Save translations
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}
      </Tabs>
    </Page>
  );
}
