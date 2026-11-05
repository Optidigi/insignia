/** Frontend-only Methods exploration. The loopback host is its only entry point.
 * Saved methods stay in this browser tab. Reset demo restores fixtures.
 */
import { render } from 'preact';
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import AdminIndexToolbar from '../../../src/components/AdminIndexToolbar.tsx';
import { AdminLocaleProvider, getAdminLocaleController, useAdminLocale } from '../../../src/shared/admin-i18n.js';
import {
  assignedProducts,
  type MethodConfiguration,
  type MethodProduct,
  methodErrors,
  methodPreviewSchema,
  newMethod,
  productReadiness,
} from './method-configuration.mts';
import Dialog from './method-dialog.tsx';
import MethodIndex from './method-index.tsx';
import { downloadMethodSummary, duplicateConfiguration, methodPreviewLimit } from './method-management.mts';
import ProductPicker from './method-product-picker.tsx';
import { projectMethodProducts } from './method-product-setups.mts';
import { readMethodReturnContext } from './method-return-context.mts';
import MethodSummary from './method-summary.tsx';
import {
  confirmMethodNavigation,
  createMethodWorkflowState,
  type MethodWorkflowEvent,
  type MethodWorkflowNavigationTarget,
  methodWorkflowDirty,
  methodWorkflowReducer,
  requestMethodNavigation,
} from './method-workflow-state.mts';
import { methodCatalogStorageKey } from './placement-method-library.mts';
import { readPlacementSetupExample, resolvePlacementPreviewStorage } from './placement-preview-storage.mts';
import { placementProductSchema } from './placement-workflow-model.mts';

const indexPath = '/admin/methods';
type MethodNotice =
  | { kind: 'method-unavailable' }
  | { kind: 'storage-failure' }
  | { kind: 'saved'; created: boolean }
  | { kind: 'duplicated' }
  | { kind: 'deleted'; count: number };

function formatMethodNotice(notice: MethodNotice, t: ReturnType<typeof useAdminLocale>['t'], locale: string): string {
  if (notice.kind === 'method-unavailable') return t('methods:workflow.notices.methodUnavailable');
  if (notice.kind === 'storage-failure') return t('methods:workflow.notices.storageFailure');
  if (notice.kind === 'saved')
    return t(notice.created ? 'methods:workflow.notices.created' : 'methods:workflow.notices.saved');
  if (notice.kind === 'duplicated') return t('methods:workflow.notices.duplicated');
  return t('methods:workflow.notices.deleted', {
    count: notice.count,
    formattedCount: new Intl.NumberFormat(locale).format(notice.count),
  });
}

function largeCatalog() {
  try {
    return sessionStorage.getItem('insignia-method-catalog') === 'large';
  } catch {
    return false;
  }
}
const storageKey = methodCatalogStorageKey(largeCatalog());
function Methods({ initial, products }: { initial: MethodConfiguration[]; products: MethodProduct[] }) {
  const { t, formatLocale } = useAdminLocale();
  const returnContext = readMethodReturnContext(location.search, products);
  function emptyMethod() {
    return { ...newMethod(), productIds: returnContext ? [returnContext.productId] : [] };
  }
  const initialId = location.pathname.startsWith(`${indexPath}/`) ? location.pathname.slice(indexPath.length + 1) : '';
  const initialWorkflow = useMemo(
    () =>
      createMethodWorkflowState(
        initial,
        initialId === 'new' ? emptyMethod() : (initial.find((method) => method.id === initialId) ?? null),
        crypto.randomUUID(),
        emptyMethod(),
      ),
    [],
  );
  const [workflow, dispatchWorkflow] = useReducer(methodWorkflowReducer, initialWorkflow);
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  function sendWorkflow(event: MethodWorkflowEvent) {
    const next = methodWorkflowReducer(workflowRef.current, event);
    workflowRef.current = next;
    dispatchWorkflow(event);
    return next;
  }
  const methods = workflow.methods;
  const editor = workflow.editor;
  const errors = workflow.errors;
  const productPicker =
    workflow.dialog.kind === 'product-picker'
      ? workflow.dialog
      : workflow.dialog.kind === 'leave' && workflow.dialog.resume.kind === 'product-picker'
        ? workflow.dialog.resume
        : null;
  const productPickerSuspended = workflow.dialog.kind === 'leave' && workflow.dialog.resume.kind === 'product-picker';
  const removing = workflow.dialog.kind === 'remove' ? workflow.dialog.targets : null;
  const duplicateDialog = workflow.dialog.kind === 'duplicate' ? workflow.dialog : null;
  const duplicating = duplicateDialog;
  const duplicateError = duplicateDialog?.error;
  const [productQuery, setProductQuery] = useState('');
  const [productPage, setProductPage] = useState(0);
  const [productSetup, setProductSetup] = useState('all');
  const productList = useRef<HTMLDivElement>(null);
  const tagButton = useRef<HTMLElementTagNameMap['s-button']>(null);
  const [notice, setNotice] = useState<MethodNotice | null>(null);
  const main = useRef<HTMLDivElement>(null);
  const current = methods.find((method) => method.id === editor?.id);
  const dirty = methodWorkflowDirty(workflow);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const claimedDialogCommits = useRef(new Set<string>());
  const historyPosition = useRef(0);
  const restoringHistory = useRef(false);
  const allowedTraversal = useRef(false);
  const matched = editor ? assignedProducts(editor, products) : [];
  const filteredProducts = matched.filter(
    (product) =>
      product.title.toLocaleLowerCase(formatLocale).includes(productQuery.trim().toLocaleLowerCase(formatLocale)) &&
      (productSetup === 'all' || (editor && productReadiness(editor, product).ready === (productSetup === 'ready'))),
  );
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / 8));
  const safePage = Math.min(productPage, pageCount - 1);
  const visibleProducts = filteredProducts.slice(safePage * 8, (safePage + 1) * 8);
  const needingSetup = editor ? matched.filter((product) => !productReadiness(editor, product).ready).length : 0;
  const availableTags = [...new Set(products.flatMap((product) => product.tags))].sort();
  const [tagQuery, setTagQuery] = useState('');
  const filteredTags = [...new Set([...availableTags, ...(editor?.tags ?? [])])].filter((tag) =>
    tag.toLocaleLowerCase(formatLocale).includes(tagQuery.trim().toLocaleLowerCase(formatLocale)),
  );

  function focusPage() {
    requestAnimationFrame(() => {
      main.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    });
  }
  function showPath(path: string, push = true) {
    if (push) {
      historyPosition.current++;
      history.pushState({ methodPosition: historyPosition.current }, '', `${path}${returnContext?.search ?? ''}`);
    }
    const id = path.startsWith(`${indexPath}/`) ? path.slice(indexPath.length + 1) : '';
    const nextEditor =
      id === 'new' ? emptyMethod() : (workflowRef.current.methods.find((method) => method.id === id) ?? null);
    sendWorkflow({ type: 'route-opened', sessionId: crypto.randomUUID(), editor: nextEditor });
    setProductQuery('');
    setProductPage(0);
    setProductSetup('all');
    setTagQuery('');
    focusPage();
  }
  function requestNavigation(target: MethodWorkflowNavigationTarget) {
    const transition = requestMethodNavigation(workflowRef.current, target, crypto.randomUUID());
    if (transition.decision.kind === 'confirm') {
      sendWorkflow({ type: 'navigation-requested', confirmationId: transition.decision.id, target });
    }
    if (transition.decision.kind === 'navigate') performNavigation(transition.decision.target);
  }
  function performNavigation(target: MethodWorkflowNavigationTarget) {
    if (target.kind === 'method-route') {
      showPath(target.path);
    } else if (target.kind === 'external') {
      dirtyRef.current = false;
      location.assign(target.href);
    } else {
      allowedTraversal.current = true;
      history.go(target.delta);
    }
  }
  function navigate(path: string) {
    requestNavigation({ kind: 'method-route', path });
  }
  useEffect(() => {
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
    const missing =
      initialId && initialId !== 'new' && !workflowRef.current.methods.some((method) => method.id === initialId);
    if (missing) setNotice({ kind: 'method-unavailable' });
    history.replaceState(
      { methodPosition: 0 },
      '',
      missing || location.pathname === '/admin/settings/methods'
        ? `${indexPath}${returnContext?.search ?? ''}`
        : location.href,
    );
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    const pop = (event: PopStateEvent) => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      const state: unknown = event.state;
      const position =
        state && typeof state === 'object' && 'methodPosition' in state && typeof state.methodPosition === 'number'
          ? state.methodPosition
          : 0;
      const delta = position - historyPosition.current;
      if (dirtyRef.current && !allowedTraversal.current && delta) {
        requestNavigation({ kind: 'history', delta });
        restoringHistory.current = true;
        history.go(-delta);
        return;
      }
      allowedTraversal.current = false;
      historyPosition.current = position;
      showPath(location.pathname, false);
    };
    // Native host and in-app navigation must use the same unsaved-change guard.
    const links = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event
        .composedPath()
        .find(
          (node): node is Element =>
            node instanceof Element && node.matches('s-link[href],s-button[href],s-clickable[href]'),
        );
      if (!link || link.getAttribute('target') === '_blank') return;
      const target = new URL(link.getAttribute('href') ?? '', location.href);
      if (target.origin !== location.origin) return;
      if (target.pathname === location.pathname && target.search === location.search && target.hash) return;
      if (target.pathname.startsWith(indexPath)) {
        event.preventDefault();
        navigate(target.pathname);
      } else if (dirtyRef.current) {
        event.preventDefault();
        requestNavigation({ kind: 'external', href: target.href });
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', pop);
    document.addEventListener('click', links, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', pop);
      document.removeEventListener('click', links, true);
    };
  }, []);
  function persistMethods(next: MethodConfiguration[]): boolean {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setNotice({ kind: 'storage-failure' });
      return false;
    }
    return true;
  }
  useEffect(() => {
    if (!notice || notice.kind === 'storage-failure') return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  function save() {
    const currentState = workflowRef.current;
    const currentEditor = currentState.editor;
    if (!currentEditor) return;
    const invalid = methodErrors(currentEditor);
    sendWorkflow({ type: 'validation-failed', sessionId: currentState.editorSessionId, errors: invalid });
    if (Object.keys(invalid).length) {
      requestAnimationFrame(() => {
        const field = main.current?.querySelector<HTMLElement>('[data-invalid="true"]');
        field?.scrollIntoView({ block: 'center', behavior: 'instant' });
        field?.focus();
      });
      return;
    }
    if (!currentEditor.id && currentState.methods.length >= methodPreviewLimit) return;
    const value = {
      ...currentEditor,
      id: currentEditor.id || crypto.randomUUID(),
      name: currentEditor.name.trim(),
      explanation: currentEditor.explanation.trim(),
    };
    const next = currentEditor.id
      ? currentState.methods.map((item) => (item.id === currentEditor.id ? value : item))
      : [...currentState.methods, value];
    if (!persistMethods(next)) return;
    sendWorkflow({ type: 'method-saved', sessionId: currentState.editorSessionId, method: value });
    history.replaceState(
      { methodPosition: historyPosition.current },
      '',
      `${indexPath}/${value.id}${returnContext?.search ?? ''}`,
    );
    setNotice({ kind: 'saved', created: !currentEditor.id });
  }
  function cancelLeave() {
    const dialog = workflowRef.current.dialog;
    if (dialog.kind === 'leave') sendWorkflow({ type: 'navigation-canceled', id: dialog.id });
  }
  function discardAndLeave() {
    const dialog = workflowRef.current.dialog;
    if (dialog.kind !== 'leave') return;
    const transition = confirmMethodNavigation(workflowRef.current, dialog.id);
    sendWorkflow({ type: 'navigation-confirmed', id: dialog.id });
    if (transition.target) performNavigation(transition.target);
  }
  function startDuplicate(source: MethodConfiguration) {
    sendWorkflow({
      type: 'duplicate-opened',
      id: crypto.randomUUID(),
      source,
      suggestedName: duplicateConfiguration(source, workflowRef.current.methods, '').name,
    });
  }
  function createDuplicate() {
    const currentState = workflowRef.current;
    const dialog = currentState.dialog;
    if (dialog.kind !== 'duplicate' || currentState.methods.length >= methodPreviewLimit) return;
    if (claimedDialogCommits.current.has(dialog.id)) return;
    const copy = {
      ...duplicateConfiguration(dialog.source, currentState.methods, crypto.randomUUID(), dialog.copyAssignment),
      name: dialog.name.trim(),
    };
    const invalid = methodErrors(copy);
    if (invalid.name) {
      sendWorkflow({ type: 'duplicate-failed', id: dialog.id, reason: 'invalid-name' });
      return;
    }
    const next = [...currentState.methods, copy];
    claimedDialogCommits.current.add(dialog.id);
    if (!persistMethods(next)) {
      claimedDialogCommits.current.delete(dialog.id);
      sendWorkflow({
        type: 'duplicate-failed',
        id: dialog.id,
        reason: 'storage-failure',
      });
      return;
    }
    sendWorkflow({ type: 'method-duplicated', id: dialog.id, method: copy });
    showPath(`${indexPath}/${copy.id}`);
    setNotice({ kind: 'duplicated' });
  }
  function requestRemoval(targets: MethodConfiguration[]) {
    sendWorkflow({ type: 'removal-opened', id: crypto.randomUUID(), targets });
  }
  function confirmRemoval() {
    const currentState = workflowRef.current;
    const dialog = currentState.dialog;
    if (dialog.kind !== 'remove' || claimedDialogCommits.current.has(dialog.id)) return;
    const removedIds = dialog.targets.map((method) => method.id);
    const ids = new Set(removedIds);
    const next = currentState.methods.filter((method) => !ids.has(method.id));
    claimedDialogCommits.current.add(dialog.id);
    if (!persistMethods(next)) {
      claimedDialogCommits.current.delete(dialog.id);
      return;
    }
    sendWorkflow({ type: 'methods-deleted', id: dialog.id, methodIds: removedIds });
    if (currentState.editor && ids.has(currentState.editor.id)) {
      dirtyRef.current = false;
      showPath(indexPath);
    }
    setNotice({ kind: 'deleted', count: dialog.targets.length });
    focusPage();
  }
  const duplicate =
    editor &&
    methods.some(
      (method) => method.id !== editor.id && method.name.toLocaleLowerCase() === editor.name.trim().toLocaleLowerCase(),
    );
  const affectedProductCount = removing
    ? new Set(removing.flatMap((method) => assignedProducts(method, products).map((product) => product.id))).size
    : 0;
  return (
    <div class="method-workflow" ref={main} tabIndex={-1}>
      <s-page
        heading={editor ? current?.name || t('methods:workflow.createTitle') : t('methods:workflow.title')}
        inlineSize="large"
      >
        {!editor && methods.length > 0 && (
          <s-button
            slot="secondary-actions"
            variant="secondary"
            onClick={() => downloadMethodSummary(methods, products)}
          >
            {t('methods:workflow.actions.exportAll')}
          </s-button>
        )}
        {returnContext && (
          <s-link slot="breadcrumb-actions" href={returnContext.returnTo}>
            {t('methods:workflow.productSetup')}
          </s-link>
        )}
        {editor
          ? !returnContext && (
              <s-link slot="breadcrumb-actions" href={indexPath}>
                {t('methods:workflow.actions.methodsBreadcrumb')}
              </s-link>
            )
          : methods.length > 0 && (
              <s-button
                slot="primary-action"
                variant="primary"
                disabled={methods.length >= methodPreviewLimit}
                onClick={() => navigate(`${indexPath}/new`)}
              >
                {t('methods:workflow.actions.create')}
              </s-button>
            )}
        {editor && current && (
          <s-button
            slot="secondary-actions"
            variant="secondary"
            icon="duplicate"
            disabled={dirty || methods.length >= methodPreviewLimit}
            onClick={() => startDuplicate(current)}
          >
            {t('methods:workflow.actions.duplicate')}
          </s-button>
        )}
        {editor && current && (
          <>
            <s-button slot="secondary-actions" variant="secondary" commandFor="method-detail-actions">
              {t('methods:workflow.actions.more')}
            </s-button>
            <s-menu id="method-detail-actions" accessibilityLabel={t('methods:workflow.actions.methodActions')}>
              <s-button disabled={dirty} onClick={() => downloadMethodSummary([current], products)}>
                {t('methods:workflow.actions.exportSummary')}
              </s-button>
              <s-button tone="critical" onClick={() => requestRemoval([current])}>
                {t('methods:workflow.actions.delete')}
              </s-button>
            </s-menu>
          </>
        )}
        {notice && (
          <div class="method-editor-notice">
            <s-box paddingBlockEnd="base">
              <div role="status">
                <s-banner
                  tone={
                    notice.kind === 'storage-failure'
                      ? 'critical'
                      : notice.kind === 'method-unavailable'
                        ? 'info'
                        : 'success'
                  }
                  dismissible
                  onDismiss={() => setNotice(null)}
                >
                  {formatMethodNotice(notice, t, formatLocale)}
                </s-banner>
              </div>
            </s-box>
          </div>
        )}
        {editor ? (
          <>
            {!current && methods.length >= methodPreviewLimit && (
              <s-banner tone="info">
                {t('methods:workflow.copy.setupLimitReached', {
                  formattedCount: new Intl.NumberFormat(formatLocale).format(methodPreviewLimit),
                })}
              </s-banner>
            )}
            {dirty && (
              <section hidden data-preview-save-bar aria-label={t('methods:workflow.copy.unsavedChanges')}>
                <s-button
                  onClick={() => {
                    sendWorkflow({ type: 'draft-discarded', sessionId: workflow.editorSessionId });
                  }}
                >
                  {t('admin-shell:shared.actions.discard')}
                </s-button>
                <s-button
                  variant="primary"
                  disabled={!editor.id && methods.length >= methodPreviewLimit}
                  onClick={save}
                >
                  {t('common:actions.save')}
                </s-button>
              </section>
            )}
            <div class="method-detail-layout">
              <div class="method-main-column">
                <s-section heading={t('methods:workflow.fields.details')}>
                  <s-stack gap="base">
                    <s-text-field
                      data-invalid={!!errors.name}
                      label={t('methods:workflow.fields.name')}
                      name="method-name"
                      value={editor.name}
                      maxLength={80}
                      required
                      error={errors.name ? t('methods:workflow.copy.nameRequired') : ''}
                      details={t('methods:workflow.fields.nameHelp')}
                      onInput={(event) =>
                        sendWorkflow({
                          type: 'method-name-edited',
                          sessionId: workflow.editorSessionId,
                          value: event.currentTarget.value,
                        })
                      }
                    />
                    <s-text-area
                      label={t('methods:workflow.fields.explanation')}
                      details={t('methods:workflow.fields.explanationHelp')}
                      name="method-description"
                      value={editor.explanation}
                      maxLength={240}
                      rows={2}
                      onInput={(event) =>
                        sendWorkflow({
                          type: 'method-explanation-edited',
                          sessionId: workflow.editorSessionId,
                          value: event.currentTarget.value,
                        })
                      }
                    />
                    {duplicate && <s-banner tone="warning">{t('methods:workflow.copy.duplicateWarning')}</s-banner>}
                  </s-stack>
                </s-section>
                <s-section heading={t('methods:workflow.fields.defaultPricing')}>
                  <s-stack gap="base">
                    <s-paragraph color="subdued">{t('methods:workflow.copy.defaultsDescription')}</s-paragraph>
                    <s-choice-list
                      label={t('methods:workflow.fields.pricing')}
                      labelAccessibilityVisibility="exclusive"
                      name="method-pricing"
                      values={[editor.pricing]}
                      onChange={(event) =>
                        sendWorkflow({
                          type: 'pricing-kind-changed',
                          sessionId: workflow.editorSessionId,
                          value: event.currentTarget.values[0] === 'product' ? 'product' : 'fixed',
                        })
                      }
                    >
                      <s-choice value="fixed">
                        {t('methods:workflow.pricing.fixed')}
                        <s-text slot="details">{t('methods:workflow.copy.fixedPriceDescription')}</s-text>
                      </s-choice>
                      <s-choice value="product">
                        {t('methods:workflow.pricing.productSpecific')}
                        <s-text slot="details">{t('methods:workflow.copy.productPricingDescription')}</s-text>
                      </s-choice>
                    </s-choice-list>
                    {editor.pricing === 'fixed' ? (
                      <div class="method-price-field">
                        <s-money-field
                          data-invalid={!!errors.amount}
                          label={t('methods:workflow.fields.pricePerLocation')}
                          name="method-amount"
                          currencyCode="EUR"
                          value={editor.amount}
                          min={0}
                          max={99999.99}
                          error={errors.amount ? t('methods:workflow.copy.priceRequired') : ''}
                          details={t('methods:workflow.fields.priceHelp')}
                          onInput={(event) =>
                            sendWorkflow({
                              type: 'default-price-edited',
                              sessionId: workflow.editorSessionId,
                              value: event.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    ) : (
                      <s-paragraph color="subdued">{t('methods:workflow.copy.productSpecificDescription')}</s-paragraph>
                    )}
                  </s-stack>
                </s-section>
                <s-section heading={t('methods:workflow.fields.productAvailability')}>
                  <s-stack gap="base">
                    <s-choice-list
                      label={t('methods:workflow.fields.assignment')}
                      labelAccessibilityVisibility="exclusive"
                      name="method-assignment"
                      values={[editor.assignment]}
                      onChange={(event) => {
                        sendWorkflow({
                          type: 'assignment-mode-changed',
                          sessionId: workflow.editorSessionId,
                          value: event.currentTarget.values[0] === 'tags' ? 'tags' : 'manual',
                        });
                        setProductQuery('');
                        setProductPage(0);
                        setProductSetup('all');
                      }}
                    >
                      <s-choice value="manual">
                        {t('methods:workflow.assignment.manual')}
                        <s-text slot="details">{t('methods:workflow.assignment.manualHelp')}</s-text>
                      </s-choice>
                      <s-choice value="tags">
                        {t('methods:workflow.assignment.tags')}
                        <s-text slot="details">{t('methods:workflow.assignment.tagsHelp')}</s-text>
                      </s-choice>
                    </s-choice-list>
                    {editor.assignment === 'manual' ? (
                      <s-stack direction="inline" gap="small">
                        <s-button
                          onClick={() =>
                            sendWorkflow({ type: 'product-picker-opened', id: crypto.randomUUID(), browse: 'products' })
                          }
                        >
                          {t('methods:workflow.assignment.selectProducts')}
                        </s-button>
                        <s-button
                          variant="tertiary"
                          onClick={() =>
                            sendWorkflow({
                              type: 'product-picker-opened',
                              id: crypto.randomUUID(),
                              browse: 'collections',
                            })
                          }
                        >
                          {t('methods:workflow.assignment.selectCollections')}
                        </s-button>
                      </s-stack>
                    ) : (
                      <s-stack gap="base">
                        <s-select
                          label={t('methods:workflow.fields.productsMustMatch')}
                          name="tag-match"
                          value={editor.tagMatch}
                          onChange={(event) =>
                            sendWorkflow({
                              type: 'tag-match-changed',
                              sessionId: workflow.editorSessionId,
                              value: event.currentTarget.value === 'all' ? 'all' : 'any',
                            })
                          }
                        >
                          <s-option value="any">{t('methods:workflow.assignment.anyTag')}</s-option>
                          <s-option value="all">{t('methods:workflow.assignment.allTags')}</s-option>
                        </s-select>
                        <div data-invalid={!!errors.tags} tabIndex={-1}>
                          <s-button ref={tagButton} commandFor="method-tags" icon="plus">
                            {t('methods:workflow.assignment.chooseTags')}
                          </s-button>
                          <s-popover id="method-tags" inlineSize="280px">
                            <s-box padding="base">
                              <s-stack gap="base">
                                <s-search-field
                                  label={t('methods:workflow.fields.searchTags')}
                                  labelAccessibilityVisibility="exclusive"
                                  placeholder={t('methods:workflow.fields.searchTags')}
                                  value={tagQuery}
                                  onInput={(event) => setTagQuery(event.currentTarget.value)}
                                />
                                <div class="method-tag-scroll">
                                  <s-stack gap="small">
                                    {filteredTags.length ? (
                                      filteredTags.map((tag) => (
                                        <s-checkbox
                                          key={tag}
                                          label={tag}
                                          checked={editor.tags.includes(tag)}
                                          onChange={(event) =>
                                            sendWorkflow({
                                              type: 'tag-toggled',
                                              sessionId: workflow.editorSessionId,
                                              tag,
                                              checked: event.currentTarget.checked,
                                            })
                                          }
                                        />
                                      ))
                                    ) : (
                                      <s-text>{t('methods:workflow.empty.noTags')}</s-text>
                                    )}
                                  </s-stack>
                                </div>
                              </s-stack>
                            </s-box>
                          </s-popover>
                          {errors.tags && (
                            <s-paragraph tone="critical">{t('methods:workflow.copy.tagRequired')}</s-paragraph>
                          )}
                        </div>
                        {editor.tags.length > 0 && (
                          <s-stack direction="inline" gap="small">
                            {editor.tags.map((tag) => (
                              <s-chip
                                removable
                                key={tag}
                                accessibilityLabel={t('methods:workflow.actions.removeTag', { tagName: tag })}
                                onRemove={() =>
                                  sendWorkflow({
                                    type: 'tag-toggled',
                                    sessionId: workflow.editorSessionId,
                                    tag,
                                    checked: false,
                                  })
                                }
                              >
                                {tag}
                              </s-chip>
                            ))}
                          </s-stack>
                        )}
                      </s-stack>
                    )}
                    {current &&
                      (() => {
                        const before = new Set(assignedProducts(current, products).map((product) => product.id));
                        const after = new Set(matched.map((product) => product.id));
                        const added = [...after].filter((id) => !before.has(id)).length;
                        const removed = [...before].filter((id) => !after.has(id)).length;
                        return added || removed ? (
                          <s-box padding="small" background="subdued" borderRadius="base">
                            <s-text>
                              {t('methods:workflow.copy.assignmentChanges', {
                                added: new Intl.NumberFormat(formatLocale).format(added),
                                removed: new Intl.NumberFormat(formatLocale).format(removed),
                              })}
                            </s-text>
                          </s-box>
                        ) : null;
                      })()}
                    <s-divider />
                    <div id="method-products" class="method-product-heading" ref={productList} tabIndex={-1}>
                      <s-heading>
                        {t('methods:index.counts.products', {
                          count: matched.length,
                          formattedCount: new Intl.NumberFormat(formatLocale).format(matched.length),
                        })}
                      </s-heading>
                      {needingSetup > 0 && (
                        <s-badge tone="warning">
                          {t('methods:workflow.copy.needsSetupCount', {
                            count: needingSetup,
                            formattedCount: new Intl.NumberFormat(formatLocale).format(needingSetup),
                          })}
                        </s-badge>
                      )}
                    </div>
                    {!matched.length ? (
                      <s-paragraph color="subdued">
                        {editor.assignment === 'tags'
                          ? editor.tags.length
                            ? t('methods:workflow.empty.noProductsForTags')
                            : t('methods:workflow.empty.chooseTags')
                          : t('methods:workflow.empty.selectProducts')}
                      </s-paragraph>
                    ) : (
                      <>
                        {needingSetup > 0 && (
                          <s-paragraph color="subdued">
                            {editor.pricing === 'fixed'
                              ? t('methods:workflow.copy.setupFixedPrice')
                              : t('methods:workflow.copy.setupProductPrice')}
                          </s-paragraph>
                        )}
                        {(matched.length > 8 || needingSetup > 0 || productQuery || productSetup !== 'all') && (
                          <AdminIndexToolbar
                            id="method-assigned-products"
                            label={t('methods:workflow.fields.searchAssignedProducts')}
                            value={productQuery}
                            maxLength={100}
                            onInput={(value) => {
                              setProductQuery(value);
                              setProductPage(0);
                            }}
                            resultStatus={t('methods:index.counts.products', {
                              count: filteredProducts.length,
                              formattedCount: new Intl.NumberFormat(formatLocale).format(filteredProducts.length),
                            })}
                            filter={{
                              label: t('methods:workflow.filter.filterAssigned'),
                              text:
                                productSetup === 'all'
                                  ? t('methods:workflow.fields.productSetup')
                                  : productSetup === 'needs'
                                    ? t('methods:workflow.filter.needsSetup')
                                    : t('methods:workflow.filter.configured'),
                              count: productSetup === 'all' ? 0 : 1,
                              content: (
                                <s-choice-list
                                  label={t('methods:workflow.fields.productSetup')}
                                  values={[productSetup]}
                                  onChange={(event) => {
                                    setProductSetup(event.currentTarget.values[0] ?? 'all');
                                    setProductPage(0);
                                  }}
                                >
                                  <s-choice value="all">{t('methods:workflow.filter.allProducts')}</s-choice>
                                  <s-choice value="needs">{t('methods:workflow.filter.needsSetup')}</s-choice>
                                  <s-choice value="ready">{t('methods:workflow.filter.configured')}</s-choice>
                                </s-choice-list>
                              ),
                            }}
                          />
                        )}

                        <div class="method-products">
                          {visibleProducts.map((product) => {
                            const setup = productReadiness(editor, product);
                            return (
                              <div key={product.id} class="method-product-row">
                                <s-thumbnail src={product.image} alt="" size="small" />
                                <div class="method-product-copy">
                                  <s-stack gap="none">
                                    <s-link
                                      tone="neutral"
                                      href={
                                        product.id === returnContext?.productId
                                          ? returnContext.returnTo
                                          : `/admin/products/${product.configurationProductId ?? product.id}/config`
                                      }
                                    >
                                      <s-text type="strong">{product.title}</s-text>
                                    </s-link>
                                    {setup.ready ? (
                                      <s-paragraph color="subdued">
                                        {t('methods:workflow.readiness.locations', {
                                          count: setup.locations,
                                          formattedCount: new Intl.NumberFormat(formatLocale).format(setup.locations),
                                        })}
                                      </s-paragraph>
                                    ) : (
                                      <s-link
                                        href={
                                          product.id === returnContext?.productId
                                            ? returnContext.returnTo
                                            : `/admin/products/${product.configurationProductId ?? product.id}/config`
                                        }
                                      >
                                        {t(
                                          setup.reason === 'configure-locations'
                                            ? 'methods:workflow.readiness.configureLocations'
                                            : 'methods:workflow.readiness.addProductPrices',
                                        )}
                                      </s-link>
                                    )}
                                  </s-stack>
                                </div>
                                {editor.assignment === 'manual' && (
                                  <s-button
                                    icon="x"
                                    variant="tertiary"
                                    accessibilityLabel={t('methods:workflow.actions.removeProduct', {
                                      productName: product.title,
                                    })}
                                    onClick={() =>
                                      sendWorkflow({
                                        type: 'manual-products-selected',
                                        sessionId: workflow.editorSessionId,
                                        productIds: editor.productIds.filter((id) => id !== product.id),
                                      })
                                    }
                                  />
                                )}
                              </div>
                            );
                          })}
                          {!visibleProducts.length && (
                            <s-stack gap="small">
                              <s-paragraph>{t('methods:workflow.filter.noProductMatch')}</s-paragraph>
                              <s-button
                                variant="tertiary"
                                onClick={() => {
                                  setProductQuery('');
                                  setProductSetup('all');
                                  setProductPage(0);
                                  requestAnimationFrame(() => productList.current?.focus());
                                }}
                              >
                                {t('methods:workflow.filter.clearProductFilters')}
                              </s-button>
                            </s-stack>
                          )}
                        </div>
                        {pageCount > 1 && (
                          <s-stack direction="inline" gap="small" justifyContent="center" alignItems="center">
                            <s-button
                              icon="chevron-left"
                              accessibilityLabel={t('methods:picker.previousProducts')}
                              disabled={!safePage}
                              onClick={() => setProductPage(safePage - 1)}
                            />
                            <s-text>
                              {t('methods:workflow.copy.productPageRange', {
                                first: new Intl.NumberFormat(formatLocale).format(safePage * 8 + 1),
                                last: new Intl.NumberFormat(formatLocale).format(
                                  Math.min((safePage + 1) * 8, filteredProducts.length),
                                ),
                                formattedCount: new Intl.NumberFormat(formatLocale).format(filteredProducts.length),
                              })}
                            </s-text>
                            <s-button
                              icon="chevron-right"
                              accessibilityLabel={t('methods:picker.nextProducts')}
                              disabled={safePage + 1 >= pageCount}
                              onClick={() => setProductPage(safePage + 1)}
                            />
                          </s-stack>
                        )}
                      </>
                    )}
                  </s-stack>
                </s-section>
              </div>
              <MethodSummary
                method={editor}
                count={matched.length}
                needsSetup={needingSetup}
                onReview={(needsOnly) => {
                  if (!matched.length && editor.assignment === 'manual') {
                    sendWorkflow({ type: 'product-picker-opened', id: crypto.randomUUID(), browse: 'products' });
                    return;
                  }
                  if (!matched.length && editor.assignment === 'tags') {
                    tagButton.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
                    tagButton.current?.focus({ preventScroll: true });
                    return;
                  }
                  setProductSetup(needsOnly ? 'needs' : 'all');
                  setProductPage(0);
                  setProductQuery('');
                  requestAnimationFrame(() => {
                    productList.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
                    productList.current?.focus({ preventScroll: true });
                  });
                }}
              />
            </div>
          </>
        ) : (
          <MethodIndex
            methods={methods}
            products={products}
            onCreate={() => navigate(`${indexPath}/new`)}
            onDuplicate={startDuplicate}
            onDelete={requestRemoval}
          />
        )}
      </s-page>
      {productPicker && editor && (
        <ProductPicker
          key={productPicker.id}
          initialBrowse={productPicker.browse}
          products={products}
          selected={editor.productIds}
          suspended={productPickerSuspended}
          onClose={() => sendWorkflow({ type: 'product-picker-canceled', id: productPicker.id })}
          onApply={(ids) => sendWorkflow({ type: 'product-picker-applied', id: productPicker.id, productIds: ids })}
        />
      )}
      {workflow.dialog.kind === 'leave' && (
        <Dialog
          heading={t('methods:workflow.copy.leaveHeading')}
          cancelLabel={t('admin-shell:shared.saveBar.keepEditing')}
          onClose={cancelLeave}
          actions={
            <s-button slot="primary-action" variant="primary" tone="critical" onClick={discardAndLeave}>
              {t('admin-shell:shared.actions.discard')}
            </s-button>
          }
        >
          <s-paragraph>{t('methods:workflow.copy.leaveDescription')}</s-paragraph>
        </Dialog>
      )}
      {duplicating && (
        <Dialog
          heading={t('methods:workflow.duplicate.title')}
          onClose={() => sendWorkflow({ type: 'duplicate-canceled', id: duplicating.id })}
          actions={
            <s-button slot="primary-action" variant="primary" onClick={createDuplicate}>
              {t('methods:workflow.duplicate.submit')}
            </s-button>
          }
        >
          <s-stack gap="base">
            <s-text-field
              label={t('methods:workflow.duplicate.name')}
              value={duplicating.name}
              maxLength={80}
              required
              error={
                duplicateError === 'invalid-name'
                  ? t('methods:workflow.copy.duplicateNameError')
                  : duplicateError === 'storage-failure'
                    ? t('methods:workflow.copy.duplicateStorageError')
                    : ''
              }
              onInput={(event) =>
                sendWorkflow({
                  type: 'duplicate-name-edited',
                  id: duplicating.id,
                  value: event.currentTarget.value,
                })
              }
            />
            <s-paragraph>{t('methods:workflow.copy.duplicateDescription')}</s-paragraph>
            {methods.some(
              (method) => method.name.toLocaleLowerCase() === duplicating.name.trim().toLocaleLowerCase(),
            ) && <s-banner tone="warning">{t('methods:workflow.copy.duplicateWarningShort')}</s-banner>}
            <s-checkbox
              label={
                duplicating.source.assignment === 'tags'
                  ? t('methods:workflow.duplicate.copyTagRule')
                  : t('methods:workflow.duplicate.copySelectedProducts')
              }
              checked={duplicating.copyAssignment}
              onChange={(event) =>
                sendWorkflow({
                  type: 'duplicate-assignment-toggled',
                  id: duplicating.id,
                  checked: event.currentTarget.checked,
                })
              }
            />
            {duplicating.copyAssignment && (
              <s-box padding="small" background="subdued" borderRadius="base">
                <s-stack gap="small">
                  <s-text>
                    {(() => {
                      const count = assignedProducts(duplicating.source, products).length;
                      return t('methods:workflow.copy.matchingProducts', {
                        count,
                        formattedCount: new Intl.NumberFormat(formatLocale).format(count),
                      });
                    })()}
                  </s-text>
                  {duplicating.source.assignment === 'tags' && (
                    <s-paragraph>
                      {t('methods:workflow.copy.tagMatchSummary', {
                        match:
                          duplicating.source.tagMatch === 'all'
                            ? t('methods:workflow.assignment.allTags')
                            : t('methods:workflow.assignment.anyTag'),
                        tags: new Intl.ListFormat(formatLocale, { type: 'conjunction' }).format(
                          duplicating.source.tags,
                        ),
                      })}
                    </s-paragraph>
                  )}
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </Dialog>
      )}
      {removing && (
        <Dialog
          heading={
            removing.length === 1
              ? t('methods:workflow.copy.removeOneHeading', { methodName: removing[0]?.name ?? '' })
              : t('methods:workflow.copy.removeManyHeading', {
                  count: removing.length,
                  formattedCount: new Intl.NumberFormat(formatLocale).format(removing.length),
                })
          }
          onClose={() => {
            const dialog = workflowRef.current.dialog;
            if (dialog.kind === 'remove') sendWorkflow({ type: 'removal-canceled', id: dialog.id });
          }}
          actions={
            <s-button slot="primary-action" variant="primary" tone="critical" onClick={confirmRemoval}>
              {removing.length === 1
                ? t('methods:index.actions.deleteMethod')
                : t('methods:index.actions.deleteMethods')}
            </s-button>
          }
        >
          <s-stack gap="base">
            {removing.length > 1 && (
              <s-unordered-list>
                {removing.slice(0, 5).map((method) => (
                  <s-list-item key={method.id}>{method.name}</s-list-item>
                ))}
              </s-unordered-list>
            )}
            {removing.length > 5 && (
              <s-paragraph>
                {t('methods:index.counts.more', {
                  count: removing.length - 5,
                  formattedCount: new Intl.NumberFormat(formatLocale).format(removing.length - 5),
                })}
              </s-paragraph>
            )}
            <s-paragraph>
              {affectedProductCount === 0
                ? t('methods:workflow.copy.noProductAssignmentsRemoved')
                : removing.length === 1
                  ? t('methods:workflow.copy.removeOneAvailability', {
                      count: affectedProductCount,
                      formattedCount: new Intl.NumberFormat(formatLocale).format(affectedProductCount),
                    })
                  : t('methods:workflow.copy.removeManyAvailability', {
                      count: affectedProductCount,
                      formattedCount: new Intl.NumberFormat(formatLocale).format(affectedProductCount),
                    })}{' '}
              {t('methods:workflow.copy.leaveSavedData')}
            </s-paragraph>
            {dirty && <s-paragraph>{t('methods:workflow.copy.leaveCurrentChanges')}</s-paragraph>}
          </s-stack>
        </Dialog>
      )}
    </div>
  );
}
async function start() {
  const root = document.getElementById('method-workflow-preview');
  if (!root) return;
  await Promise.all(
    ['s-page', 's-modal', 's-choice-list', 's-money-field'].map((tag) => customElements.whenDefined(tag)),
  );
  try {
    const response = await fetch(`/__preview/method-workflow/data${largeCatalog() ? '?catalog=large' : ''}`);
    if (!response.ok) throw new Error('Preview data unavailable');
    const data = methodPreviewSchema.parse(await response.json());
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    let methods = data.methods;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) methods = methodPreviewSchema.shape.methods.parse(JSON.parse(stored));
    } catch {
      /* Ignore obsolete or unavailable local preview storage. */
    }
    let products = data.products;
    if (!largeCatalog()) {
      const catalog = await fetch('/__preview/placement-workflow/catalog');
      if (!catalog.ok) throw new Error('Product setup could not be loaded.');
      const placements = placementProductSchema.array().parse(await catalog.json());
      products = projectMethodProducts(
        products,
        placements,
        readPlacementSetupExample(),
        resolvePlacementPreviewStorage(),
      );
    }
    render(
      <AdminLocaleProvider controller={getAdminLocaleController(document)}>
        <Methods initial={methods} products={products} />
      </AdminLocaleProvider>,
      root,
    );
  } catch {
    root.removeAttribute('role');
    root.removeAttribute('aria-label');
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
    render(
      <AdminLocaleProvider controller={getAdminLocaleController(document)}>
        <MethodPreviewLoadFailure onRetry={() => void start()} />
      </AdminLocaleProvider>,
      root,
    );
  }
}

function MethodPreviewLoadFailure({ onRetry }: { onRetry(): void }) {
  const { t } = useAdminLocale();
  return (
    <s-page heading={t('methods:workflow.title')}>
      <s-section>
        <s-stack gap="base">
          <s-banner tone="critical">{t('methods:workflow.empty.loadFailure')}</s-banner>
          <s-button onClick={onRetry}>{t('common:actions.retry')}</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
void start();
