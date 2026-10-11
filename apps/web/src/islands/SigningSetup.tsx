import { useEffect, useRef, useState } from 'preact/hooks';
import {
  type SigningOwnerView,
  signingAuthorizationDenied,
  signingOwnerRequest,
} from '../shared/signing-owner-request.js';

const text = {
  READY: 'Signing setup is ready to start.',
  PENDING: 'Signing setup is in progress.',
  WAITING_FOR_VERIFICATION: 'Signing setup is waiting for current verification.',
  PROVISIONED: 'Signing setup is complete.',
  STOPPED: 'Signing setup stopped. Contact support before trying again.',
  UNCERTAIN: 'Signing setup result is uncertain. Contact support before trying again.',
};
function token() {
  const bridge = (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
  if (!bridge?.idToken) return Promise.reject(new Error('Signing setup unavailable'));
  return bridge.idToken();
}
export default function SigningSetup({
  onComplete,
  onAuthorizationDenied,
}: {
  onComplete?: () => void;
  onAuthorizationDenied?: () => void;
}) {
  const [status, setStatus] = useState<SigningOwnerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempted = useRef(false);
  const refreshes = useRef(0);
  const mounted = useRef(true);
  function denied(error: unknown) {
    if (!mounted.current || !signingAuthorizationDenied(error)) return;
    setStatus(null);
    onAuthorizationDenied?.();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (status?.state !== 'PENDING' && status?.state !== 'WAITING_FOR_VERIFICATION') return;
    if (refreshes.current++ >= 40) return;
    const timer = setTimeout(() => {
      void recover();
    }, 1000);
    return () => clearTimeout(timer);
  }, [status]);
  async function recover() {
    try {
      const value = await signingOwnerRequest('GET', token);
      if (!mounted.current) return;
      setStatus(value);
      setUncertain(attempted.current && value.state === 'READY');
      if (value.state === 'PROVISIONED') onComplete?.();
    } catch (error) {
      denied(error);
      if (mounted.current) {
        setStatus(null);
        setUncertain(true);
      }
    }
  }
  async function setup() {
    if (attempted.current || busy || !status?.actionAvailable) return;
    attempted.current = true;
    setBusy(true);
    try {
      const value = await signingOwnerRequest('POST', token);
      if (mounted.current) {
        setStatus(value);
        if (value.state === 'PROVISIONED') onComplete?.();
      }
    } catch (error) {
      denied(error);
      if (mounted.current) {
        setUncertain(true);
        await recover();
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <s-section heading="Signing setup">
      <p role="status">
        {uncertain ? text.UNCERTAIN : status ? text[status.state] : 'Check signing setup to view its status.'}
      </p>
      {status?.actionAvailable && !attempted.current && (
        <s-button
          disabled={busy}
          onClick={() => {
            void setup();
          }}
        >
          Set up signing
        </s-button>
      )}
      {(!status ||
        uncertain ||
        status?.state === 'PENDING' ||
        status?.state === 'WAITING_FOR_VERIFICATION' ||
        status?.state === 'UNCERTAIN') && (
        <s-button
          disabled={busy}
          onClick={() => {
            void recover();
          }}
        >
          {status || uncertain ? 'Check status' : 'Check signing setup'}
        </s-button>
      )}
    </s-section>
  );
}
