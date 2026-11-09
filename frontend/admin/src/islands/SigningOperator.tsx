import { useEffect, useRef, useState } from 'preact/hooks';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import { createSigningOperator } from './signing-operator';

export default function SigningOperator() {
  const [, render] = useState(0);
  const operator = useRef<ReturnType<typeof createSigningOperator> | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    operator.current = createSigningOperator(
      authenticatedJson,
      {
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
      },
      () => {
        if (mounted.current) render((n) => n + 1);
      },
    );
    void operator.current.refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  const view = operator.current?.view();
  useAdminPageReady(Boolean(view && !view.busy));
  return (
    <s-page heading="Signing setup" inlineSize="small">
      <s-section heading="Operator action">
        <s-stack gap="base">
          <div role="status" aria-live="polite" aria-atomic="true">
            {view?.message ?? 'Loading signing status.'}
          </div>
          {view?.readOnly && (
            <s-paragraph>Read-only recovery. Setup cannot be submitted again from this browser.</s-paragraph>
          )}
          <s-paragraph>
            This action sets up the allocated signing configuration. It does not publish a product.
          </s-paragraph>
          <s-button variant="primary" disabled={!view?.canSetup} onClick={() => void operator.current?.setup()}>
            Set up signing configuration
          </s-button>
          <s-button disabled={view?.busy ?? true} onClick={() => void operator.current?.refresh()}>
            Refresh status
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
