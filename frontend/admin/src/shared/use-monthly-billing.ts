import { useEffect, useState } from 'preact/hooks';
import { authenticatedJson } from './admin-request.js';
import type { BillingView } from './billing-view.js';

export function useMonthlyBilling(enabled: boolean) {
  const [view, setView] = useState<BillingView | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void authenticatedJson<BillingView>('/api/admin/billing', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setView(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setView(null);
      });
    return () => controller.abort();
  }, [enabled, revision]);

  return {
    view,
    productionTools: !enabled || view?.productionTools === true,
    refresh: () => {
      setView(null);
      setRevision((value) => value + 1);
    },
  };
}
