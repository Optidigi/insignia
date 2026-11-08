import type { MerchantCustomerWordingView } from '@insignia/contracts';
import { render } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ProductConfig } from '../../../../frontend/designer/src/config';
import { resolveCustomerHostLocale } from '../../../../frontend/designer/src/customer-language-policy';
import { readCustomerLanguagePreference } from '../../../../frontend/designer/src/customer-language-preference';
import { DesignerDesignSwitch } from '../../../../frontend/designer/src/design-switch';
import type { ClosedDesignerProps } from '../../../../frontend/designer/src/designer';
import { Designer } from '../../../../frontend/designer/src/index';
import type { Artwork, Design, Print } from '../../../../frontend/designer/src/model';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import type { CartReceipt, CartRequest, DesignerPorts, UploadRequest } from '../../../../frontend/designer/src/runtime';
import { DesignerRepair, type RepairAction } from './repair';

const channel = window.name;
// This sandboxed srcdoc frame deliberately shares its host origin. Firefox can
// leave document.referrer empty here; it is not a reliable handshake authority.
const parentOrigin = window.parent.location.origin;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; progress?: UploadRequest['onProgress'] };
const pending = new Map<string, Pending>();
function send(type: string, data: Record<string, unknown> = {}) {
  window.parent.postMessage({ type, channel, ...data }, parentOrigin);
}
function invoke<T>(
  action: 'upload' | 'renew' | 'prepare' | 'commit',
  request: CartRequest | UploadRequest,
  file?: File,
  artwork?: Artwork,
): Promise<T> {
  const id = crypto.randomUUID();
  const { signal, ...body } = request;
  const onProgress = 'onProgress' in body ? body.onProgress : undefined;
  if ('onProgress' in body) delete body.onProgress;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      pending.delete(id);
      send('insignia:designer:abort', { id });
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    pending.set(id, {
      ...(onProgress ? { progress: onProgress } : {}),
      resolve(value) {
        signal.removeEventListener('abort', abort);
        resolve(value as T);
      },
      reject(error) {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    });
    send('insignia:designer:request', {
      id,
      action,
      request: body,
      ...(file ? { file } : {}),
      ...(artwork ? { artwork } : {}),
    });
  });
}
type Initial = {
  config?: ProductConfig;
  repair?: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean };
  wording?: MerchantCustomerWordingView;
  locale?: string;
  initialDesign?: Design;
  initialBaseline?: Design;
  initialPrints?: Print[];
  initialArtworks?: Artwork[];
  previewOnly?: boolean;
  requiresCartReview?: boolean;
};
function Closed({ completion }: { completion: CartReceipt | null }) {
  const sent = useRef(false);
  useLayoutEffect(() => {
    if (sent.current) return;
    sent.current = true;
    send('insignia:designer:closed', { receipt: completion });
  }, [completion]);
  return null;
}

function HostClosed({
  state,
  pendingGroup,
  onCancel,
  onConfirm,
}: {
  state: ClosedDesignerProps;
  pendingGroup: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  useLayoutEffect(() => {
    if (pendingGroup && !state.hasDraft) onConfirm();
  }, [pendingGroup, state.hasDraft]);
  if (!pendingGroup) return <Closed completion={state.completion} />;
  return state.hasDraft ? <DesignerDesignSwitch onCancel={onCancel} onConfirm={onConfirm} /> : null;
}

function Frame({ initial }: { initial: Initial }) {
  const [config, setConfig] = useState(initial.config);
  const [repair, setRepair] = useState(initial.repair);
  const [open, setOpen] = useState(true);
  const [visible, setVisible] = useState(true);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [quote, setQuote] = useState<DesignerQuoteReview>();
  const [hostError, setHostError] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [wording, setWording] = useState(initial.wording);
  const [language, setLanguage] = useState(readCustomerLanguagePreference());
  const wordingLocale = language ?? resolveCustomerHostLocale(initial.locale, navigator.languages);
  const ports = useMemo<DesignerPorts>(
    () => ({
      artwork: {
        upload: (file, request) => invoke<Artwork>('upload', request, file),
        renew: (artwork, request) => invoke<Artwork>('renew', request, undefined, artwork),
        apply: (artwork, request) => invoke<Artwork>('renew', request, undefined, artwork),
      },
      review: initial.previewOnly ? undefined : { prepare: (request) => invoke<void>('prepare', request) },
      cart: { commit: (request) => invoke<CartReceipt>('commit', request) },
    }),
    [],
  );
  useLayoutEffect(() => {
    send('insignia:designer:initialized');
    function update(event: MessageEvent) {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== channel) return;
      if (event.data.type === 'insignia:designer:repair') setRepair(event.data.repair);
      if (event.data.type === 'insignia:designer:open') {
        setVisible(true);
        setOpen(true);
      }
      if (event.data.type === 'insignia:designer:suspend') setVisible(false);
      if (event.data.type === 'insignia:designer:request-close') {
        setOpen(false);
        setPendingGroup(null);
      }
      if (event.data.type === 'insignia:designer:host-error') setHostError((value) => value + 1);
      if (event.data.type === 'insignia:designer:cart-reviewed') {
        setQuote(undefined);
        setReviewed((value) => value + 1);
      }
      if (event.data.type === 'insignia:designer:prices') {
        setConfig(event.data.config);
        if (event.data.wording) setWording(event.data.wording);
      }
      if (event.data.type === 'insignia:designer:quote') setQuote(event.data.quote);
      if (event.data.type === 'insignia:designer:previews') {
        setConfig(
          (current) =>
            current && {
              ...current,
              colors: current.colors.map((color) => ({
                ...color,
                images:
                  (event.data.colors as ProductConfig['colors']).find((next) => next.id === color.id)?.images ??
                  color.images,
              })),
            },
        );
      }
    }
    window.addEventListener('message', update);
    return () => window.removeEventListener('message', update);
  }, []);
  return (
    <>
      {config && (
        <Designer
          key="workflow"
          onPreviewFailure={(url) => send('insignia:designer:preview-failed', { url })}
          suspended={!!repair || !visible}
          config={config}
          ports={ports}
          isOpen={open}
          wordingOverlay={wording?.overlays[wordingLocale] ?? null}
          onLanguagePreferenceChange={setLanguage}
          locale={initial.locale}
          initialDesign={initial.initialDesign}
          initialBaseline={initial.initialBaseline}
          initialPrints={initial.initialPrints}
          initialArtworks={initial.initialArtworks}
          previewOnly={initial.previewOnly}
          requiresCartReview={initial.requiresCartReview}
          quoteReview={quote}
          hostErrorSignal={hostError}
          cartReviewedSignal={reviewed}
          onSelectQuoteGroup={(id) => {
            setPendingGroup(id);
            setOpen(false);
          }}
          onOpenChange={setOpen}
          retainViewForConfirmation={pendingGroup !== null}
          renderClosed={(state) => (
            <HostClosed
              state={state}
              pendingGroup={pendingGroup}
              onCancel={() => {
                setPendingGroup(null);
                state.onResume();
                setOpen(true);
              }}
              onConfirm={() => {
                if (pendingGroup) send('insignia:designer:select-group', { id: pendingGroup });
              }}
            />
          )}
        />
      )}
      {repair && (
        <DesignerRepair
          locale={wordingLocale}
          wording={wording}
          canStart={repair.canStart}
          canRemoveGroup={repair.canRemoveGroup}
          canRemoveAll={repair.canRemoveAll}
          onClose={() => send('insignia:designer:closed')}
          onAction={(action: RepairAction) => {
            const id = crypto.randomUUID();
            return new Promise<DesignerQuoteReview | undefined>((resolve, reject) => {
              pending.set(id, {
                resolve(value) {
                  resolve(value as DesignerQuoteReview | undefined);
                },
                reject,
              });
              send('insignia:designer:repair-action', { id, action });
            });
          }}
        />
      )}
    </>
  );
}
let mounted = false;
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.channel !== channel) return;
  if (
    event.data.type === 'insignia:designer:progress' &&
    typeof event.data.id === 'string' &&
    ['uploading', 'processing'].includes(event.data.phase)
  ) {
    pending.get(event.data.id)?.progress?.(event.data.phase);
    return;
  }
  if (
    (event.data.type === 'insignia:designer:result' || event.data.type === 'insignia:designer:repair-result') &&
    typeof event.data.id === 'string'
  ) {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.ok === true) request.resolve(event.data.value);
    else
      request.reject(
        Object.assign(new Error('Live operation unavailable'), {
          status: [403, 404, 410, 422].includes(event.data.status) ? event.data.status : undefined,
        }),
      );
  }
  if (event.data.type === 'insignia:designer:init' && !mounted) {
    mounted = true;
    render(<Frame initial={event.data.initial} />, document.body);
  }
});
send('insignia:designer:ready');
