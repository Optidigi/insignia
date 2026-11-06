import type { PurchaseView } from '@insignia/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { authenticatedJson } from '../shared/admin-request';
import { createCustomerArtworkLinkClient, hasCustomerArtworkSlots } from '../shared/customer-artwork-link';

export default function CustomerArtworkShareLink({
  purchase,
  disabled,
  deny,
}: {
  purchase: PurchaseView;
  disabled: boolean;
  deny: (error: unknown) => void;
}) {
  const { t } = useAdminLocale();
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const client = useRef<ReturnType<typeof createCustomerArtworkLinkClient> | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    client.current = undefined;
    setState('idle');
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [purchase.purchaseId, purchase.artworkVersion]);
  if (!hasCustomerArtworkSlots(purchase, now)) return null;
  async function copy() {
    if (state === 'busy' || disabled) return;
    const current = generation.current;
    setState('busy');
    client.current ??= createCustomerArtworkLinkClient(
      purchase.purchaseId,
      authenticatedJson,
      async (value) => {
        try {
          await navigator.clipboard.writeText(value);
          return;
        } catch {
          /* Embedded browser policy may require the synchronous copy path. */
        }
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const field = document.createElement('textarea');
        field.value = value;
        field.readOnly = true;
        field.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;';
        document.body.append(field);
        try {
          field.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        } finally {
          field.remove();
          focused?.focus({ preventScroll: true });
        }
      },
      undefined,
      window.location.origin,
    );
    try {
      await client.current.copy();
      if (current === generation.current) setState('copied');
    } catch (error) {
      if (current === generation.current) {
        setState('failed');
        deny(error);
      }
    }
  }
  return (
    <s-stack gap="small-300">
      <s-button disabled={disabled || state === 'busy'} loading={state === 'busy'} onClick={() => void copy()}>
        {t('orders:purchaseArtwork.customerLink.copy')}
      </s-button>
      <s-text
        color={state === 'failed' ? 'base' : 'subdued'}
        tone={state === 'failed' ? 'critical' : 'auto'}
        aria-live="polite"
      >
        {state === 'failed'
          ? t('orders:purchaseArtwork.customerLink.failed')
          : state === 'copied'
            ? t('orders:purchaseArtwork.customerLink.copied')
            : t('orders:purchaseArtwork.customerLink.help')}
      </s-text>
    </s-stack>
  );
}
