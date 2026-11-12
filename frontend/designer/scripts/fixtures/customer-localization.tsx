import { render } from "preact";
import type { CustomerWordingOverlay } from "@insignia/ui-localization/customer";
import type { SupportedLanguage } from "@insignia/ui-localization/core";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Artwork, Print } from "../../src/model";
import { Designer } from "../../src/designer";
import type { DesignerQuoteReview } from "../../src/quote-review";
import { configSchema } from "../../src/config";
import { createProductModel } from "../../src/model";
import type { CartReceipt, CartRequest, DesignerPorts } from "../../src/runtime";
import "../../src/style.css";
import "../../src/theme.css";
import "../../src/polish.css";
import "../../src/review.css";

interface DeferredCommit {
  requestId: string;
  idempotencyKey: string;
  resolve: (receipt: CartReceipt) => void;
  reject: (reason?: unknown) => void;
}

interface DeferredUpload {
  resolve: (artwork: Artwork) => void;
  reject: (reason?: unknown) => void;
}

interface DeferredReview {
  request: CartRequest;
  resolve: (presentation: { expiresAt: string }) => void;
  reject: (reason: Error) => void;
}

interface LocalizationTestApi {
  reviewRequests(): number;
  setQuoteReview(review: Omit<DesignerQuoteReview, "intentId">): void;
  resolveReview(expiresAt: string): void;
  rejectReview(code?: string): void;
  selectedQuoteGroups(): string[];
  setLocale(locale: string): void;
  setMethod(method: { label: string; description: string }): void;
  setWordingOverlay(overlay: CustomerWordingOverlay | null): void;
  commitRequests(): Array<{ requestId: string; idempotencyKey: string }>;
  languagePreferenceChanges(): Array<SupportedLanguage | null>;
  rejectCommit(index: number): void;
  resolveCommit(index: number): void;
  rejectUpload(index: number): void;
}

const movable = new URLSearchParams(location.search).has('movable');
const config = configSchema.parse({
  id: "localization-fixture",
  name: "Localization fixture",
  description: "Fixture product for customer language regression checks.",
  storeName: "Fixture store",
  productName: "Fixture shirt",
  productDescription: "A simple fixture product.",
  basePrice: 1000,
  currency: "EUR",
  locale: "en-NL",
  garment: "tshirt",
  preview: "illustration",
  maxQuantity: 999,
  artworkLater: false,
  sizes: [{ id: "small", label: "Small" }],
  colors: [{ id: "white", name: "White", hex: "#ffffff", availableSizeIds: ["small"] }],
  views: [{ id: "front", label: "Front", illustration: "front" }],
  positions: [{
    id: "front-print",
    name: "Front print",
    view: "front",
    x: 50,
    y: 45,
    width: 20,
    ...(movable ? { movementArea: { x: 50, y: 45, width: 40, height: 40 } } : {}),
    price: 100,
    dimensions: [10],
    sizePrices: [100],
    methodIds: ["screen"],
  }],
  methods: [{ id: "screen", label: "Screen printing", description: "Vivid colors and fine detail", surcharge: 0 }],
});
const artwork: Artwork = {
  id: "fixture-artwork",
  name: "fixture-logo.svg",
  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath fill='red' d='M0 0h10v10H0z'/%3E%3C/svg%3E",
  width: 10,
  height: 10,
};
const initialPrints: Print[] = [{
  ...createProductModel(config).initialPrint("front-print"),
  artworkId: artwork.id,
}];

function CustomerLocalizationFixture() {
  const [locale, setLocale] = useState("en");
  const [method, setMethod] = useState(config.methods[0]!);
  const [wordingOverlay, setWordingOverlay] = useState<CustomerWordingOverlay | null>(null);
  const [quoteReview, setQuoteReview] = useState<DesignerQuoteReview>();
  const reviews = useRef<DeferredReview[]>([]);
  const selectedGroups = useRef<string[]>([]);
  const commits = useRef<DeferredCommit[]>([]);
  const uploads = useRef<DeferredUpload[]>([]);
  const languagePreferences = useRef<Array<SupportedLanguage | null>>([]);
  const ports = useMemo<DesignerPorts>(() => ({
    ...(new URLSearchParams(location.search).has("quote-review") ? {
      review: {
        prepare: (request: CartRequest) => new Promise<{ expiresAt: string }>((resolve, reject) => {
          reviews.current.push({ request, resolve, reject });
        }),
      },
    } : {}),
    artwork: {
      upload: async () => new Promise<Artwork>((resolve, reject) => {
        uploads.current.push({ resolve, reject });
      }),
    },
    cart: {
      commit: async (request: CartRequest) => new Promise<CartReceipt>((resolve, reject) => {
        commits.current.push({
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          resolve,
          reject,
        });
      }),
    },
  }), []);

  useEffect(() => {
    const api: LocalizationTestApi = {
      setLocale,
      setMethod: (value) => setMethod(current => ({ ...current, ...value })),
      setWordingOverlay,
      reviewRequests: () => reviews.current.length,
      setQuoteReview: (review) => {
        const latest = reviews.current.at(-1);
        if (latest) setQuoteReview({ ...review, intentId: latest.request.idempotencyKey });
      },
      resolveReview: (expiresAt) => reviews.current.at(-1)?.resolve({ expiresAt }),
      rejectReview: (code) =>
        reviews.current.at(-1)?.reject(Object.assign(new Error("fixture-review-failure"), code ? { code } : {})),
      selectedQuoteGroups: () => [...selectedGroups.current],
      commitRequests: () => commits.current.map(({ requestId, idempotencyKey }) => ({ requestId, idempotencyKey })),
      languagePreferenceChanges: () => [...languagePreferences.current],
      rejectCommit: (index) => commits.current[index]?.reject(new Error("fixture-cart-failure")),
      resolveCommit: (index) => {
        const request = commits.current[index];
        if (!request) return;
        request.resolve({
          kind: "applied",
          requestId: request.requestId,
          designId: "fixture-design",
          operation: "added",
          authority: "local-preview",
        });
      },
      rejectUpload: (index) => uploads.current[index]?.reject(new Error("fixture-upload-failure")),
    };
    (window as Window & { __customerLocalizationTest?: LocalizationTestApi }).__customerLocalizationTest = api;
    return () => {
      Reflect.deleteProperty(window, "__customerLocalizationTest");
    };
  }, []);

  return (
    <Designer
      config={{ ...config, methods: [method] }}
      ports={ports}
      isOpen
      onOpenChange={() => undefined}
      initialPrints={initialPrints}
      initialArtworks={[artwork]}
      locale={locale}
      wordingOverlay={wordingOverlay}
      {...(quoteReview ? { quoteReview } : {})}
      onSelectQuoteGroup={(id) => selectedGroups.current.push(id)}
      onLanguagePreferenceChange={(preference) => languagePreferences.current.push(preference)}
    />
  );
}

render(<CustomerLocalizationFixture />, document.getElementById("root")!);

declare global { interface Window { __customerLocalizationTest: LocalizationTestApi; } }
