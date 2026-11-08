import { type CustomerArtworkPublicViewDto, CustomerArtworkPublicViewSchema } from '@insignia/contracts';
import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildCustomerArtworkConfig } from '../../../../frontend/designer/src/customer-artwork-config';
import { resolveCustomerHostLocale } from '../../../../frontend/designer/src/customer-language-policy';
import { readCustomerLanguagePreference } from '../../../../frontend/designer/src/customer-language-preference';
import { Designer } from '../../../../frontend/designer/src/index';
import { designerAlias } from '../../../../frontend/designer/src/live-config';
import type { DesignerPorts } from '../../../../frontend/designer/src/runtime';
import { createArtworkUpload } from '../../../web/src/islands/artwork-upload';

async function request<T>(capability: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/customer-artwork/v1', {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${capability}` },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Object.assign(new Error('Customer artwork unavailable'), { status: response.status });
  return (await response.json()) as T;
}
function CustomerArtwork({ capability }: { capability: string }) {
  const locale = resolveCustomerHostLocale(undefined, navigator.languages);
  const [language, setLanguage] = useState(readCustomerLanguagePreference());
  const [view, setView] = useState<CustomerArtworkPublicViewDto>();
  const overlay = view?.wording?.overlays[language ?? locale] ?? null;
  const { t } = useMemo(
    () => createCustomerTranslator(language ?? locale, { wordingOverlay: overlay }),
    [language, locale, overlay],
  );
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const reading = useRef<AbortController>();
  async function load() {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setFailed(false);
    try {
      const next = CustomerArtworkPublicViewSchema.parse(
        await request(capability, { action: 'view' }, controller.signal),
      );
      if (controller.signal.aborted) return;
      setView(next);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    }
  }
  useEffect(() => {
    void load();
    return () => reading.current?.abort();
  }, []);
  const configuration = view?.configurations[0];
  const mapped = useMemo(
    () =>
      configuration ? buildCustomerArtworkConfig(configuration, view?.currency ?? 'EUR', location.origin) : undefined,
    [configuration, view?.currency],
  );
  const ports = useMemo<DesignerPorts>(() => {
    async function missingSlot(uploadRequest: import('../../../../frontend/designer/src/runtime').UploadRequest) {
      if (!configuration) throw new Error('No missing artwork');
      const placement = ((configuration.readProduct ?? configuration.selectedSetup?.product)?.views ?? [])
        .flatMap((view) => view.placements)
        .find((placement) => designerAlias(placement.id) === uploadRequest.target);
      const slot = configuration.slots.find((slot) => slot.placementId === placement?.id);
      const current = CustomerArtworkPublicViewSchema.parse(
        await request(capability, { action: 'view' }, uploadRequest.signal),
      );
      if (
        !slot ||
        !current.slots.some(
          (candidate) => candidate.groupIndex === slot.groupIndex && candidate.placementId === slot.placementId,
        )
      )
        throw new Error('Artwork already submitted');
      return { slot, current };
    }
    async function apply(
      artwork: import('../../../../frontend/designer/src/model').Artwork,
      uploadRequest: import('../../../../frontend/designer/src/runtime').UploadRequest,
    ) {
      const { slot, current } = await missingSlot(uploadRequest);
      const attach = {
        action: 'attach',
        groupIndex: slot.groupIndex,
        placementId: slot.placementId,
        assetId: artwork.id,
        expectedVersion: current.artworkVersion,
        requestId: crypto.randomUUID(),
      };
      let result: unknown;
      try {
        result = await request(capability, attach, uploadRequest.signal);
      } catch (error) {
        if (uploadRequest.signal.aborted || (error && typeof error === 'object' && 'status' in error)) throw error;
        // Same bounded command identity only; never retry a different attachment after ambiguous transport.
        result = await request(capability, attach, uploadRequest.signal);
      }
      CustomerArtworkPublicViewSchema.pick({
        purchaseId: true,
        expiresAt: true,
        artworkVersion: true,
        slots: true,
      }).parse(result);
      return artwork;
    }
    const uploader = createArtworkUpload({
      api: async <T,>(path: string, init: RequestInit = {}) => {
        const route = /^\/api\/artwork(?:\/([a-f0-9-]+)\/(complete|status|preview))?$/.exec(path);
        if (!route) throw new Error('Invalid artwork request');
        const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        return request<T>(
          capability,
          { action: route[2] ?? 'begin', ...body, ...(route[1] ? { assetId: route[1] } : {}) },
          init.signal ?? undefined,
        );
      },
    });
    return {
      artwork: {
        apply,
        async renew(artwork, uploadRequest) {
          if (!artwork.assetExpiresAt) throw Object.assign(new Error('Artwork unavailable'), { status: 410 });
          const preview = await uploader.renew(
            {
              assetId: artwork.id,
              url: artwork.url,
              aspectRatio: artwork.width / artwork.height,
              expiresAt: artwork.previewExpiresAt ?? '',
              assetExpiresAt: artwork.assetExpiresAt,
            },
            uploadRequest.signal,
          );
          return {
            ...artwork,
            url: preview.url,
            previewExpiresAt: preview.expiresAt,
            assetExpiresAt: preview.assetExpiresAt,
          };
        },
        async upload(file, uploadRequest) {
          await missingSlot(uploadRequest);
          const preview = await uploader.upload(
            file,
            (state) => uploadRequest.onProgress?.(state === 'Processing artwork' ? 'processing' : 'uploading'),
            uploadRequest.signal,
          );
          return apply(
            {
              id: preview.assetId,
              name: file.name,
              url: preview.url,
              width: preview.aspectRatio * 1000,
              height: 1000,
              previewExpiresAt: preview.expiresAt,
              assetExpiresAt: preview.assetExpiresAt,
            },
            uploadRequest,
          );
        },
      },
      cart: {
        async commit() {
          throw new Error('Post-order artwork cannot change a cart');
        },
      },
    };
  }, [configuration]);
  if (failed)
    return (
      <main className="app">
        <section className="review-section" role="alert">
          <h1>{t('customer:postOrder.title')}</h1>
          <p>{t('customer:postOrder.unavailable')}</p>
          <button type="button" className="primary-button" onClick={() => void load()}>
            {t('customer:postOrder.retry')}
          </button>
        </section>
      </main>
    );
  if (!view)
    return (
      <main className="app">
        <p role="status">{t('customer:postOrder.loading')}</p>
      </main>
    );
  if (!mapped || !configuration)
    return (
      <main className="app">
        <section className="review-section" role="status">
          <h1>{t('customer:postOrder.title')}</h1>
          <p>{t('customer:postOrder.saved')}</p>
        </section>
      </main>
    );
  return (
    <Designer
      key={`${configuration.groupIndex}:${view.artworkVersion}`}
      config={mapped}
      ports={ports}
      isOpen={open}
      locale={locale}
      wordingOverlay={overlay}
      onLanguagePreferenceChange={setLanguage}
      initialPrints={mapped.positions.map((position) => {
        const method = position.methodIds[0];
        if (!method) throw new Error('Missing artwork method');
        return { id: position.id, method, size: 0, artworkId: null };
      })}
      previewContextLabel={t('customer:postOrder.title')}
      previewNotice={t('customer:postOrder.notice')}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) void load();
      }}
      renderClosed={({ onResume }) => (
        <main className="app">
          <section className="review-section">
            <h1>{t('customer:postOrder.title')}</h1>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setOpen(true);
                onResume();
              }}
            >
              {t('customer:postOrder.continue')}
            </button>
          </section>
        </main>
      )}
    />
  );
}
export function mountCustomerArtwork() {
  const capability = new URLSearchParams(location.hash.slice(1)).get('capability');
  // Fragments never reach HTTP; remove it before any subsequent navigation or copying.
  history.replaceState(null, '', location.pathname);
  if (!capability || !/^[a-f0-9]{64}$/.test(capability)) {
    const { t } = createCustomerTranslator(navigator.languages[0]);
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = t('customer:postOrder.unavailable');
    document.body.append(message);
    return;
  }
  render(<CustomerArtwork capability={capability} />, document.body);
}
