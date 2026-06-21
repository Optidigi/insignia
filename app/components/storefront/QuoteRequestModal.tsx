import { useMemo, useRef, useState } from "react";
import type { StorefrontConfig } from "./types";
import { proxyUrl } from "../../lib/storefront/proxy-url.client";
import { getTranslations, detectLocale } from "./i18n";
import { QuantityGrid } from "./QuantityGrid";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconCloudUpload,
  IconHelpCircle,
  IconLoaderCircle,
  IconX,
} from "./icons";
import "./storefront-modal.css";

type QuoteStep = "artwork" | "decoration" | "placement" | "quote";
type DecorationChoice = "print" | "embroidery" | "advise";
type MaxFormatChoice = "10cm" | "20cm" | "30cm" | "other";

type QuoteLogo =
  | { type: "none" }
  | { type: "later" }
  | { type: "uploaded"; logoAssetId: string; previewPngUrl: string; sanitizedSvgUrl: string | null };

const STEPS: Array<{ id: QuoteStep; label: string }> = [
  { id: "artwork", label: "Artwork" },
  { id: "decoration", label: "Bedrukking" },
  { id: "placement", label: "Plaatsing" },
  { id: "quote", label: "Offerte" },
];

export function QuoteRequestModal({
  config,
  returnUrl,
}: {
  config: StorefrontConfig;
  returnUrl: string | null;
}) {
  const [step, setStep] = useState<QuoteStep>("artwork");
  const [imageIndex, setImageIndex] = useState(0);
  const [logo, setLogo] = useState<QuoteLogo>({ type: "none" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [decorationChoice, setDecorationChoice] = useState<DecorationChoice>("advise");
  const [maxFormatChoice, setMaxFormatChoice] = useState<MaxFormatChoice>("10cm");
  const [maxFormatCustom, setMaxFormatCustom] = useState("");
  const [placementWish, setPlacementWish] = useState("");
  const [notes, setNotes] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [submitState, setSubmitState] = useState<"ready" | "submitting" | "success" | "error">("ready");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const initialVariant =
      config.variants.find((v) => v.id === config.variantId && v.available) ??
      config.variants.find((v) => v.available);
    return initialVariant ? { [initialVariant.id]: 1 } : {};
  });
  const t = getTranslations(config.locale ?? detectLocale());

  const media = useMemo(() => {
    const productMedia = config.productMedia.map((m) => ({ url: m.url, alt: m.altText ?? config.productTitle }));
    const viewMedia = config.views
      .filter((v) => v.imageUrl)
      .map((v) => ({ url: v.imageUrl!, alt: v.name ?? config.productTitle }));
    return viewMedia.length > 0 ? viewMedia : productMedia;
  }, [config.productMedia, config.productTitle, config.views]);

  const activeImage = media[imageIndex] ?? null;
  const currentStepIndex = STEPS.findIndex((s) => s.id === step);
  const quantityLines = useMemo(
    () =>
      config.variants
        .map((variant) => ({
          variantId: variant.id,
          variantTitle: variant.title,
          sizeLabel: variant.sizeLabel,
          quantity: quantities[variant.id] ?? 0,
        }))
        .filter((line) => line.quantity > 0),
    [config.variants, quantities],
  );
  const totalQuantity = quantityLines.reduce((sum, line) => sum + line.quantity, 0);
  const uploadedLogoUrl =
    logo.type === "uploaded" ? logo.sanitizedSvgUrl ?? logo.previewPngUrl : null;
  const quantitySummary =
    quantityLines.length > 0
      ? quantityLines.map((line) => `${line.sizeLabel || line.variantTitle} x ${line.quantity}`).join(", ")
      : "Geen aantallen";

  const closeNow = () => {
    const safeReturnUrl =
      returnUrl && /^\/(?!\/|\\)/.test(returnUrl) ? returnUrl : null;
    const isAppOrigin = (origin: string) => {
      const host = new URL(origin).host;
      return host === "insignia-stitchs.nl" || host === "insignia-stitchs.optidigi.nl";
    };
    let origin = window.location.origin;
    try {
      const referrerOrigin = document.referrer ? new URL(document.referrer).origin : null;
      if (referrerOrigin && !isAppOrigin(referrerOrigin)) {
        origin = referrerOrigin;
      } else if (isAppOrigin(origin)) {
        origin = "https://stitchs.nl";
      }
    } catch {
      // Keep current origin when referrer parsing fails.
    }
    window.location.href = safeReturnUrl ? `${origin}${safeReturnUrl}` : `${origin}/`;
  };

  const canContinue = (() => {
    if (step === "artwork") return logo.type !== "none";
    if (step === "decoration") return maxFormatChoice !== "other" || maxFormatCustom.trim().length > 0;
    if (step === "placement") return placementWish.trim().length > 0;
    if (step === "quote") return totalQuantity > 0 && contactName.trim().length > 0 && /\S+@\S+\.\S+/.test(contactEmail);
    return true;
  })();

  const goNext = async () => {
    if (!canContinue) return;
    if (step === "quote") {
      await submitQuoteRequest();
      return;
    }
    setStep(STEPS[Math.min(currentStepIndex + 1, STEPS.length - 1)].id);
  };

  const goBack = () => {
    setSubmitError(null);
    setStep(STEPS[Math.max(currentStepIndex - 1, 0)].id);
  };

  const uploadFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Het bestand is groter dan 5 MB.");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["svg", "png", "jpg", "jpeg", "pdf"].includes(ext)) {
      setUploadError("Upload een SVG, PNG, JPG of PDF bestand.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(proxyUrl("/apps/insignia/uploads"), { method: "POST", body: formData });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "Upload mislukt");
      }
      const json = (await res.json()) as {
        logoAsset: { id: string; previewPngUrl: string; sanitizedSvgUrl: string | null };
      };
      setLogo({
        type: "uploaded",
        logoAssetId: json.logoAsset.id,
        previewPngUrl: json.logoAsset.previewPngUrl,
        sanitizedSvgUrl: json.logoAsset.sanitizedSvgUrl,
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  };

  const submitQuoteRequest = async () => {
    setSubmitState("submitting");
    setSubmitError(null);
    try {
      const res = await fetch(proxyUrl("/apps/insignia/quote-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: config.productId,
          variantId: config.variantId,
          productConfigId: config.productConfigId,
          logoAssetId: logo.type === "uploaded" ? logo.logoAssetId : null,
          artworkStatus: logo.type === "uploaded" ? "PROVIDED" : "PENDING_CUSTOMER",
          decorationChoice,
          maxFormatChoice,
          maxFormatCustom: maxFormatChoice === "other" ? maxFormatCustom : null,
          placementWish,
          notes,
          contactName,
          contactEmail,
          contactPhone,
          companyName,
          productSnapshot: {
            productTitle: config.productTitle,
            variantTitle: config.variants.find((v) => v.id === config.variantId)?.title ?? null,
            methodLabel: decorationSummary,
            maxFormatLabel: formatSummary,
            imageUrl: activeImage?.url ?? null,
            logoUrl: uploadedLogoUrl,
            totalQuantity,
            quantities: quantityLines,
          },
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data.error?.message ?? "Offerteaanvraag mislukt");
      }
      setSubmitState("success");
    } catch (error) {
      setSubmitState("error");
      setSubmitError(error instanceof Error ? error.message : "Offerteaanvraag mislukt");
    }
  };

  const decorationSummary =
    decorationChoice === "print"
      ? "Bedrukken"
      : decorationChoice === "embroidery"
        ? "Borduren"
        : "Stitchs adviseert";
  const formatSummary =
    maxFormatChoice === "other" ? maxFormatCustom || "Anders" : `Tot ${maxFormatChoice.replace("cm", " cm")}`;

  return (
    <div className="insignia-modal quote-mode" role="dialog" aria-modal="true" aria-label="Personaliseren">
      <header className="insignia-modal-header">
        <div className="insignia-modal-header-title insignia-only-desktop">
          <span className="title">Personaliseren</span>
          <span className="subtitle">Offerteaanvraag</span>
        </div>
        <div className="insignia-tabs" role="tablist" aria-label="Offerte stappen">
          {STEPS.map((tab, index) => {
            const state = index === currentStepIndex ? "active" : index < currentStepIndex ? "completed" : undefined;
            return (
              <button key={tab.id} type="button" role="tab" className="insignia-tab" data-state={state} disabled={index > currentStepIndex}>
                <span className="tab-icon" aria-hidden="true">{index < currentStepIndex ? <IconCheck size={14} /> : index + 1}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="insignia-modal-close" onClick={closeNow} aria-label="Sluiten">
          <IconX size={18} />
        </button>
      </header>

      <div className="insignia-modal-body-wrap quote-body-wrap" data-step={step}>
        <aside className="insignia-desktop-preview quote-product-panel">
          <div className="insignia-desktop-preview-canvas quote-product-preview-canvas">
            <div className="insignia-canvas-frame quote-product-canvas-frame" data-state={activeImage ? "ready" : "empty"} data-context="panel">
              <span className="insignia-canvas-view-label">Productfoto</span>
              <div className="insignia-canvas-layer" data-role="incoming">
                {activeImage ? (
                  <img className="quote-product-image" src={activeImage.url} alt={activeImage.alt} />
                ) : (
                  <div className="insignia-canvas-status">{config.productTitle}</div>
                )}
              </div>
              {media.length > 1 && (
                <>
                  <button className="insignia-canvas-nav insignia-canvas-nav--prev" type="button" aria-label="Vorige foto" onClick={() => setImageIndex((i) => (i - 1 + media.length) % media.length)}>
                    <IconArrowLeft size={18} />
                  </button>
                  <button className="insignia-canvas-nav insignia-canvas-nav--next" type="button" aria-label="Volgende foto" onClick={() => setImageIndex((i) => (i + 1) % media.length)}>
                    <IconArrowRight size={18} />
                  </button>
                </>
              )}
            </div>
            {media.length > 1 && (
              <div className="insignia-canvas-dots" data-context="panel" aria-label="Productfoto's">
                {media.slice(0, 8).map((_, i) => (
                  <button key={i} type="button" className="insignia-canvas-dot" data-active={i === imageIndex} aria-label={`Foto ${i + 1}`} onClick={() => setImageIndex(i)} />
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="insignia-desktop-content quote-content">
        <main className="insignia-desktop-content-body quote-step-panel">
          {step === "artwork" && (
            <section>
              <h2>Upload je artwork</h2>
              <p>Upload je logo of ontwerp voor de offerte. Je kunt het bestand ook later sturen.</p>
              <input
                ref={inputRef}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadFile(file);
                }}
              />
              <button type="button" className="quote-upload-box" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {uploading ? <IconLoaderCircle size={34} className="insignia-spin" /> : <IconCloudUpload size={38} />}
                <strong>{logo.type === "uploaded" ? "Artwork geupload" : "Tik om je artwork te uploaden"}</strong>
                <span>SVG · PNG · JPG · PDF (Max 5 MB)</span>
              </button>
              {logo.type === "uploaded" && (
                <div className="quote-upload-result">
                  <img className="quote-upload-preview" src={logo.previewPngUrl} alt="" />
                  <span className="quote-upload-file-label">Bestand toegevoegd</span>
                </div>
              )}
              {uploadError && <p className="quote-error">{uploadError}</p>}
              <div className="quote-divider"><span>of</span></div>
              <button type="button" className="quote-later-card" onClick={() => setLogo({ type: "later" })} data-selected={logo.type === "later"}>
                <IconHelpCircle size={22} />
                <span><strong>Bestand later sturen</strong><small>Je kunt je logo na de aanvraag mailen.</small></span>
                <IconArrowRight size={18} />
              </button>
              <p className="quote-info">Wij controleren altijd of het bestand geschikt is voor productie.</p>
            </section>
          )}

          {step === "decoration" && (
            <section>
              <h2>Kies je bedrukking</h2>
              <p>Geef aan welke techniek en welk maximaal formaat je wilt laten offreren.</p>
              <h3>Techniek</h3>
              <QuoteRadio value="print" selected={decorationChoice} onChange={setDecorationChoice} title="Bedrukken" body="Voor scherpe details en kleur." />
              <QuoteRadio value="embroidery" selected={decorationChoice} onChange={setDecorationChoice} title="Borduren" body="Voor een luxe, duurzame afwerking." />
              <QuoteRadio value="advise" selected={decorationChoice} onChange={setDecorationChoice} title="Laat Stitchs adviseren" body="Wij kiezen de beste optie voor product en ontwerp." />
              <h3>Maximaal formaat</h3>
              <div className="quote-format-grid">
                {(["10cm", "20cm", "30cm", "other"] as MaxFormatChoice[]).map((value) => (
                  <QuoteFormat key={value} value={value} selected={maxFormatChoice} onChange={setMaxFormatChoice} label={value === "other" ? "Anders, namelijk" : `Tot ${value.replace("cm", " cm")}`} />
                ))}
              </div>
              <input className="quote-input" placeholder="Vul gewenst formaat in" value={maxFormatCustom} disabled={maxFormatChoice !== "other"} onChange={(e) => setMaxFormatCustom(e.target.value)} />
              <p className="quote-muted">Het exacte formaat wordt later afgestemd op product, materiaal en techniek.</p>
            </section>
          )}

          {step === "placement" && (
            <section>
              <h2>Beschrijf de plaatsing</h2>
              <p>Vertel waar je het logo of ontwerp ongeveer wilt hebben. Wij beoordelen wat mogelijk en mooi is.</p>
              <label className="quote-label" htmlFor="quote-placement-wish">Plaatsingswens</label>
              <textarea id="quote-placement-wish" className="quote-textarea large" placeholder="Bijvoorbeeld: zichtbare voorkant, borst, mouw of een plek die volgens jullie mooi past." value={placementWish} onChange={(e) => setPlacementWish(e.target.value)} />
              <h3>Extra informatie</h3>
              <label className="quote-label" htmlFor="quote-notes">Opmerkingen</label>
              <textarea id="quote-notes" className="quote-textarea" placeholder="Bijvoorbeeld: meerdere posities, kleuren, deadline of speciale wensen." value={notes} onChange={(e) => setNotes(e.target.value)} />
              <p className="quote-info">Gebruik gewone taal. Je hoeft geen exacte drukpositie op te geven.</p>
            </section>
          )}

          {step === "quote" && (
            <section>
              {submitState === "success" ? (
                <div className="quote-success-page">
                  <span className="quote-success-icon" aria-hidden="true">
                    <IconCheck size={26} />
                  </span>
                  <h2>Offerteaanvraag ontvangen</h2>
                  <p>Dank je. Stitchs bekijkt je product, artwork, aantallen en plaatsingswens en neemt contact met je op.</p>
                  <div className="quote-summary">
                    <div><strong>Product</strong><span>{config.productTitle}</span></div>
                    <div><strong>Aantal</strong><span>{quantitySummary}</span></div>
                    <div><strong>Techniek</strong><span>{decorationSummary}</span></div>
                    <div><strong>Plaatsingswens</strong><span>{placementWish.split("\n")[0]}</span></div>
                  </div>
                </div>
              ) : (
                <>
                  <h2>Offerte aanvragen</h2>
                  <p>Controleer je aanvraag en vul je contactgegevens in. Stitchs neemt contact met je op met een passende offerte.</p>
                  <div className="quote-summary">
                    <div><strong>Artwork</strong><span>{logo.type === "uploaded" ? "Geupload" : "Later sturen"}</span></div>
                    {uploadedLogoUrl && <div><strong>Artwork URL</strong><span><a href={uploadedLogoUrl} target="_blank" rel="noreferrer">{uploadedLogoUrl}</a></span></div>}
                    <div><strong>Techniek</strong><span>{decorationSummary}</span></div>
                    <div><strong>Maximaal formaat</strong><span>{formatSummary}</span></div>
                    <div><strong>Aantal</strong><span>{quantitySummary}</span></div>
                    <div><strong>Plaatsingswens</strong><span>{placementWish.split("\n")[0]}</span></div>
                  </div>

                  <div className="insignia-qty-header quote-qty-header">
                    <span className="insignia-qty-header-title">Aantallen</span>
                    <span className="insignia-qty-header-meta">
                      {totalQuantity} {totalQuantity === 1 ? "stuk" : "stuks"}
                    </span>
                  </div>
                  <QuantityGrid
                    variants={config.variants}
                    quantities={quantities}
                    onChange={setQuantities}
                    variantAxis={config.variantAxis ?? "size"}
                    t={t}
                  />

                  <h3>Contactgegevens</h3>
                  <div className="quote-contact-grid">
                    <input className="quote-input" placeholder="Je naam" value={contactName} onChange={(e) => setContactName(e.target.value)} aria-label="Naam" />
                    <input className="quote-input" placeholder="je@email.nl" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} aria-label="E-mail" />
                    <input className="quote-input" placeholder="06 12345678" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} aria-label="Telefoon" />
                    <input className="quote-input" placeholder="Naam van je bedrijf" value={companyName} onChange={(e) => setCompanyName(e.target.value)} aria-label="Bedrijf" />
                  </div>
                  <p className="quote-info strong">Dit is geen bestelling. Je ontvangt eerst een offerte op basis van product, artwork, formaat en plaatsingswens.</p>
                  {submitState === "error" && <p className="quote-error">{submitError}</p>}
                </>
              )}
            </section>
          )}
        </main>
        <footer className="insignia-modal-footer quote-footer">
        <div className="insignia-footer-price">
          <span className="insignia-footer-price-label">Type aanvraag</span>
          <span className="insignia-footer-price-value">Offerte</span>
        </div>
        <div className="insignia-footer-actions quote-footer-actions">
          {submitState !== "success" && currentStepIndex > 0 && (
            <button type="button" className="insignia-btn insignia-btn--ghost" onClick={goBack}>
              <IconArrowLeft size={14} /> Terug
            </button>
          )}
          {submitState === "success" ? (
            <button type="button" className="insignia-btn insignia-btn--primary" onClick={closeNow}>
              Terug naar product
              <IconArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="insignia-btn insignia-btn--primary" onClick={() => void goNext()} disabled={!canContinue || submitState === "submitting"}>
              {step === "quote" ? (submitState === "submitting" ? "Versturen..." : "Offerte aanvragen") : "Volgende stap"}
              <IconArrowRight size={14} />
            </button>
          )}
        </div>
        </footer>
        </section>
      </div>
    </div>
  );
}

function QuoteRadio({
  value,
  selected,
  onChange,
  title,
  body,
}: {
  value: DecorationChoice;
  selected: DecorationChoice;
  onChange: (value: DecorationChoice) => void;
  title: string;
  body: string;
}) {
  return (
    <button type="button" className="quote-choice" data-selected={selected === value} onClick={() => onChange(value)}>
      <span className="quote-radio-dot" />
      <span><strong>{title}</strong><small>{body}</small></span>
    </button>
  );
}

function QuoteFormat({
  value,
  selected,
  onChange,
  label,
}: {
  value: MaxFormatChoice;
  selected: MaxFormatChoice;
  onChange: (value: MaxFormatChoice) => void;
  label: string;
}) {
  return (
    <button type="button" className="quote-format" data-selected={selected === value} onClick={() => onChange(value)}>
      <span className="quote-radio-dot" />
      {label}
    </button>
  );
}
