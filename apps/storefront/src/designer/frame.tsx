import type { MerchantCustomerWordingView } from '@insignia/contracts';
import { render } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ProductConfig } from '../../../../frontend/designer/src/config';
import { resolveCustomerHostLocale } from '../../../../frontend/designer/src/customer-language-policy';
import { readCustomerLanguagePreference } from '../../../../frontend/designer/src/customer-language-preference';
import type { ClosedDesignerProps } from '../../../../frontend/designer/src/designer';
import { DesignerHostActions } from '../../../../frontend/designer/src/host-actions';
import { Designer } from '../../../../frontend/designer/src/index';
import type { Artwork, Design, Print } from '../../../../frontend/designer/src/model';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import type { CartReceipt, CartRequest, DesignerPorts, UploadRequest } from '../../../../frontend/designer/src/runtime';
import { DesignerRepair, type RepairAction } from './repair';

const channel = window.name;
const parentOrigin = new URL(document.referrer).origin;
type Pending = { resolve(value: unknown): void; reject(error: Error): void };
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
  choices?: { id: string; label: string }[];
  config?: ProductConfig;
  repair?: { canStart: boolean; canRemoveGroup: boolean; canRemoveAll?: boolean };
  wording?: MerchantCustomerWordingView;
  locale?: string;
  initialDesign?: Design;
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
  visible,
  productName,
  choices,
  pendingGroup,
  onChoose,
  onCancel,
  onConfirm,
  onClose,
  onResume,
  onStartNew,
}: {
  state: ClosedDesignerProps;
  visible: boolean;
  productName: string;
  choices: readonly { id: string; label: string }[];
  pendingGroup: string | null;
  onChoose(id: string): void;
  onCancel(): void;
  onConfirm(): void;
  onClose(): void;
  onResume(): void;
  onStartNew(): void;
}) {
  useLayoutEffect(() => {
    if (pendingGroup && !state.hasDraft) onConfirm();
  }, [pendingGroup, state.hasDraft]);
  if (!visible && !pendingGroup) return <Closed completion={state.completion} />;
  return (
    <DesignerHostActions
      {...state}
      productName={productName}
      choices={choices}
      onEditChoice={onChoose}
      switchingDesign={pendingGroup && state.hasDraft ? pendingGroup : state.switchingDesign}
      onCancelSwitch={pendingGroup ? onCancel : state.onCancelSwitch}
      onConfirmSwitch={pendingGroup ? onConfirm : state.onConfirmSwitch}
      onResume={() => {
        onResume();
        state.onResume();
      }}
      onStartNew={() => {
        onStartNew();
        state.onStartNew();
      }}
      onClose={onClose}
    />
  );
}

function Frame({ initial }: { initial: Initial }) {
  const [choices, setChoices] = useState(initial.choices ?? []);
  const [config, setConfig] = useState(initial.config);
  const [repair, setRepair] = useState(initial.repair);
  const [open, setOpen] = useState(true);
  const [hostOpen, setHostOpen] = useState(false);
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
        setHostOpen(true);
      }
      if (event.data.type === 'insignia:designer:suspend') setVisible(false);
      if (event.data.type === 'insignia:designer:request-close') {
        setOpen(false);
        setHostOpen(false);
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
      if (event.data.type === 'insignia:designer:saved-choices') setChoices(event.data.choices);
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
          onOpenChange={(value) => {
            setOpen(value);
            if (value) setHostOpen(false);
          }}
          renderClosed={(state) => (
            <HostClosed
              state={state}
              productName={config.productName}
              visible={hostOpen}
              choices={choices}
              pendingGroup={pendingGroup}
              onChoose={setPendingGroup}
              onCancel={() => {
                setPendingGroup(null);
                setHostOpen(false);
                state.onResume();
                setOpen(true);
              }}
              onConfirm={() => {
                if (pendingGroup) send('insignia:designer:select-group', { id: pendingGroup });
              }}
              onClose={() => {
                setHostOpen(false);
                setPendingGroup(null);
              }}
              onResume={() => setHostOpen(false)}
              onStartNew={() => {
                setHostOpen(false);
                setQuote(undefined);
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
          status: [403, 404, 410].includes(event.data.status) ? event.data.status : undefined,
        }),
      );
  }
  if (event.data.type === 'insignia:designer:init' && !mounted) {
    mounted = true;
    render(<Frame initial={event.data.initial} />, document.body);
  }
});
send('insignia:designer:ready');
