import { useRef, useEffect } from "preact/hooks";

type ErrorStateProps = {
  onRetry: () => void;
  orderId: string | undefined;
};

export function ErrorState({ onRetry, orderId }: ErrorStateProps) {
  const retryRef = useRef<Element>(null);

  useEffect(() => {
    const el = retryRef.current;
    if (!el) return;
    el.addEventListener("click", onRetry);
    return () => el.removeEventListener("click", onRetry);
  }, [onRetry]);

  return (
    <s-stack direction="block" gap="base">
      <s-banner tone="critical" heading="Couldn't load customization data">
        Refresh the page or open Insignia to retry.
      </s-banner>
      <s-button variant="secondary" type="button" ref={retryRef}>
        Retry
      </s-button>
      {orderId && (
        <s-button
          variant="primary"
          inline-size="fill"
          href={`app:orders/${encodeURIComponent(orderId)}`}
        >
          Open in Insignia →
        </s-button>
      )}
    </s-stack>
  );
}
