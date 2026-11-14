import { useEffect, useRef, useState } from 'preact/hooks';
import AdminDisclosure from '../components/AdminDisclosure';
import StorefrontProductTest from '../components/StorefrontProductTest';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready';
import {
  storefrontLinks,
  type ThemeSetupStatus,
  type ThemeTaskStatus,
  themeSetupStatus,
  unknownThemeSetup,
} from '../shared/storefront-setup';
import '../styles/storefront-setup.css';

type Phase = 'loading' | 'ready' | 'unsupported' | 'failed';
type Bridge = { config?: { shop?: unknown }; app?: { extensions?: () => Promise<unknown> } };
type Links = ReturnType<typeof storefrontLinks>;

function StorefrontSetup() {
  const { t: translateUi } = useAdminLocale();
  const [links, setLinks] = useState<Links>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<ThemeSetupStatus>(unknownThemeSetup);
  const [retrying, setRetrying] = useState(false);
  const themeRegion = useRef<HTMLElement>(null);
  const retry = useRef<() => void>(() => {});
  useAdminPageReady(phase !== 'loading');

  useEffect(() => {
    const bridge = (window as unknown as { shopify?: Bridge }).shopify;
    const nextLinks = storefrontLinks(
      bridge?.config?.shop,
      document.querySelector<HTMLMetaElement>('meta[name="shopify-api-key"]')?.content,
    );
    setLinks(nextLinks);
    let disposed = false;
    let inFlight = false;
    let departed = false;
    let checkAfterReturn = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const extensions = bridge?.app?.extensions;
    const check = async () => {
      if (disposed) return;
      if (!nextLinks || typeof extensions !== 'function') {
        setPhase('unsupported');
        return;
      }
      if (inFlight) return;
      inFlight = true;
      setPhase('loading');
      setStatus(unknownThemeSetup());
      try {
        const value = await Promise.race([
          extensions.call(bridge?.app),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Theme check timed out')), 8000);
          }),
        ]);
        if (!disposed) {
          setStatus(themeSetupStatus(value));
          setPhase('ready');
        }
      } catch {
        if (!disposed) setPhase('failed');
      } finally {
        clearTimeout(timer);
        inFlight = false;
        if (!disposed && checkAfterReturn) {
          checkAfterReturn = false;
          void check();
        }
      }
    };
    retry.current = () => {
      void check();
    };
    const leave = () => {
      departed = true;
    };
    const returned = () => {
      if (document.visibilityState === 'hidden' || !departed) return;
      departed = false;
      if (inFlight) checkAfterReturn = true;
      else void check();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') leave();
      else returned();
    };
    window.addEventListener('blur', leave);
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', visibility);
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', visibility);
      retry.current = () => {};
    };
  }, []);

  useEffect(() => {
    if (!retrying || phase === 'loading') return;
    if (phase === 'ready') themeRegion.current?.focus();
    setRetrying(false);
  }, [phase, retrying]);

  // Only the Add/Enable links lead to a theme edit that Shopify keeps unsaved until the merchant saves it.
  const themeSaveNeeded = phase === 'ready' && Object.values(status).includes('available');
  const unknown = phase === 'unsupported' || (phase === 'ready' && Object.values(status).includes('unknown'));
  return (
    <s-page inlineSize="small" heading={translateUi('settings:storefrontSetup.storefrontSetup')}>
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        {translateUi('settings:storefrontSetup.settings')}
      </s-link>
      <div class="storefront-setup" data-storefront-phase={phase}>
        {!links && phase !== 'loading' ? (
          <s-banner heading={translateUi('settings:storefrontSetup.openInsigniaInShopify')} tone="info">
            <s-paragraph>
              {translateUi(
                'settings:storefrontSetup.openTheAppFromShopifyAdminToUseThemeLinksOrOpenYourThemeFromOnlineStoreThemesAndAddInsigni',
              )}
            </s-paragraph>
          </s-banner>
        ) : phase === 'failed' || retrying ? (
          <s-banner heading={translateUi('settings:storefrontSetup.themeStatusCouldnTBeChecked')} tone="warning">
            <s-stack gap="base">
              <s-paragraph>
                {translateUi('settings:storefrontSetup.youCanStillUseTheThemeEditorOrTryCheckingAgain')}
              </s-paragraph>
              <s-button
                loading={retrying}
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  retry.current();
                }}
              >
                {translateUi('settings:storefrontSetup.retry')}
              </s-button>
            </s-stack>
          </s-banner>
        ) : unknown ? (
          <s-banner heading={translateUi('settings:storefrontSetup.themeSetupNeedsAManualCheck')} tone="info">
            <s-paragraph>
              {translateUi('settings:storefrontSetup.openTheThemeEditorToReviewAnyItemMarkedNotVerified')}
            </s-paragraph>
          </s-banner>
        ) : null}
        <section
          ref={themeRegion}
          tabIndex={-1}
          aria-label={translateUi('settings:storefrontSetup.publishedThemeSetup')}
        >
          <s-section heading={translateUi('settings:storefrontSetup.publishedTheme')}>
            <s-stack gap="large">
              {themeSaveNeeded && (
                <s-paragraph color="subdued">
                  {translateUi('settings:storefrontSetup.saveThemeChangesInShopify')}
                </s-paragraph>
              )}
              <div aria-busy={phase === 'loading'}>
                <ThemeTask kind="button" status={status.button} links={links} phase={phase} />
                <s-divider />
                <ThemeTask kind="cart" status={status.cart} links={links} phase={phase} />
              </div>
              <AdminDisclosure label={translateUi('settings:storefrontSetup.otherThemesAndCompatibility')}>
                <s-unordered-list>
                  <s-list-item>
                    <s-text fontWeight="medium">{translateUi('settings:storefrontSetup.productTemplates')}</s-text>{' '}
                    {translateUi('settings:storefrontSetup.productTemplatesGuidance')}
                  </s-list-item>
                  <s-list-item>
                    <s-text fontWeight="medium">{translateUi('settings:storefrontSetup.unpublishedThemes')}</s-text>{' '}
                    {translateUi('settings:storefrontSetup.unpublishedThemesGuidance')}
                  </s-list-item>
                  <s-list-item>
                    <s-text fontWeight="medium">{translateUi('settings:storefrontSetup.themeCompatibility')}</s-text>{' '}
                    {translateUi('settings:storefrontSetup.compatibilityGuidance')}
                  </s-list-item>
                </s-unordered-list>
              </AdminDisclosure>
            </s-stack>
          </s-section>
        </section>
        <StorefrontProductTest editor={links?.editor ?? null} />
        <span class="storefront-setup__announcement" role="status" aria-live="polite">
          {phase === 'loading'
            ? translateUi('settings:storefrontSetup.checkingAnnouncement')
            : phase === 'failed'
              ? translateUi('settings:storefrontSetup.failedAnnouncement')
              : phase === 'unsupported'
                ? translateUi('settings:storefrontSetup.unsupportedAnnouncement')
                : translateUi('settings:storefrontSetup.finishedAnnouncement')}
        </span>
      </div>
    </s-page>
  );
}

function ThemeTask({
  kind,
  status,
  links,
  phase,
}: {
  kind: 'button' | 'cart';
  status: ThemeTaskStatus;
  links: Links;
  phase: Phase;
}) {
  const { t: translateUi } = useAdminLocale();
  const checking = phase === 'loading';
  const button = kind === 'button';
  const active = !checking && status === 'active';
  const available = !checking && status === 'available';
  const title = button ? translateUi('settings:themeTask.buttonTitle') : translateUi('settings:themeTask.cartTitle');
  const label = checking
    ? translateUi('settings:themeTask.checking')
    : active
      ? button
        ? translateUi('settings:themeTask.added')
        : translateUi('settings:themeTask.enabled')
      : available
        ? button
          ? translateUi('settings:themeTask.notAdded')
          : translateUi('settings:themeTask.notEnabled')
        : status === 'unavailable'
          ? translateUi('settings:themeTask.unavailable')
          : phase === 'failed'
            ? translateUi('settings:themeTask.couldNotCheck')
            : translateUi('settings:themeTask.notVerified');
  const action = available
    ? button
      ? translateUi('settings:themeTask.addToTheme')
      : translateUi('settings:themeTask.enableInShopify')
    : active
      ? translateUi('settings:themeTask.editInShopify')
      : translateUi('settings:themeTask.openThemeEditor');
  const href = links
    ? available
      ? button
        ? links.button
        : links.cart
      : button
        ? links.editor
        : links.cartEditor
    : undefined;
  return (
    <div class="storefront-setup__task" data-theme-task={kind}>
      <div class="storefront-setup__task-copy">
        <div class="storefront-setup__task-heading">
          <s-heading>{title}</s-heading>
          <s-badge tone={active ? 'success' : 'neutral'}>{label}</s-badge>
        </div>
        <s-paragraph>
          {active
            ? button
              ? translateUi('settings:themeTask.buttonActive')
              : translateUi('settings:themeTask.cartActive')
            : available
              ? button
                ? translateUi('settings:themeTask.buttonAvailable')
                : translateUi('settings:themeTask.cartAvailable')
              : button
                ? translateUi('settings:themeTask.buttonUnknown')
                : translateUi('settings:themeTask.cartUnknown')}
        </s-paragraph>
      </div>
      <div class="storefront-setup__task-action">
        {href && (
          <s-button
            href={href}
            target="_top"
            accessibilityLabel={translateUi(
              button ? 'settings:themeTask.buttonAccessible' : 'settings:themeTask.cartAccessible',
              { action },
            )}
          >
            {action}
          </s-button>
        )}
      </div>
    </div>
  );
}

export default withAdminLocale(StorefrontSetup);
