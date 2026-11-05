import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import AdminIndexToolbar from '../components/AdminIndexToolbar';
import AdminResourceTable, {
  ResourceTableBody,
  ResourceTableCell,
  ResourceTableHead,
  ResourceTableHeader,
  ResourceTableRow,
} from '../components/AdminResourceTable';
import AdminSkeleton from '../components/AdminSkeleton';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import { createMethodLibraryWorkflow } from './method-library-workflow';

function MethodLibrary() {
  const { t, formatLocale } = useAdminLocale();
  const [, renderWorkflow] = useState(0);
  const workflow = useMemo(
    () =>
      createMethodLibraryWorkflow({
        request: authenticatedJson<unknown>,
        key: () => crypto.randomUUID(),
        changed: () => renderWorkflow((revision) => revision + 1),
      }),
    [],
  );
  const { transaction, methods, error, notice } = workflow.snapshot;
  const [query, setQuery] = useState('');
  const editorSession = transaction.editor;
  const editorOpen = editorSession.kind !== 'closed';
  const editing =
    editorSession.kind === 'closed'
      ? null
      : {
          method:
            editorSession.kind === 'rename'
              ? (methods.find((item) => item.id === editorSession.methodId) ?? null)
              : null,
        };
  const name = editorSession.kind === 'closed' ? '' : editorSession.name;
  const editorMethodId = editorSession.kind === 'rename' ? editorSession.methodId : null;
  const deleting = transaction.removal.kind === 'closed' ? null : { methodId: transaction.removal.methodId };
  const loading = transaction.read === 'idle' || transaction.read === 'loading' || transaction.read === 'suspended';
  const busy = transaction.write.kind === 'writing';
  const readFailed = transaction.read === 'failed';
  const denied = transaction.read === 'denied';
  const uncertain = transaction.write.kind === 'uncertain';
  const editor = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const nameField = useRef<HTMLElementTagNameMap['s-text-field']>(null);
  useEffect(() => {
    let active = true;
    void customElements.whenDefined('s-modal').then(() => {
      if (!active) return;
      if (editorOpen) editor.current?.showOverlay();
      else editor.current?.hideOverlay();
    });
    return () => {
      active = false;
    };
  }, [editorOpen, transaction.editorRevision]);
  useAdminPageReady(!loading);
  // Each opening has its own identity, including a same-method reopen batched with hide.
  const removal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const removalOpen = transaction.removal.kind !== 'closed';
  useEffect(() => {
    let active = true;
    void customElements.whenDefined('s-modal').then(() => {
      if (!active) return;
      if (removalOpen) removal.current?.showOverlay();
      else removal.current?.hideOverlay();
    });
    return () => {
      active = false;
    };
  }, [removalOpen, transaction.removalRevision]);
  async function load(freshSession = false) {
    if (await workflow.load(freshSession)) setQuery('');
  }
  useEffect(() => {
    const suspend = () => workflow.suspend();
    const resume = (event: Event) => {
      event.preventDefault();
      void load(true);
    };
    void load();
    window.addEventListener('pagehide', suspend);
    document.addEventListener('insignia:admin-bfcache-resume', resume);
    return () => {
      workflow.dispose();
      window.removeEventListener('pagehide', suspend);
      document.removeEventListener('insignia:admin-bfcache-resume', resume);
    };
  }, [workflow]);
  useLayoutEffect(() => {
    const field = nameField.current;
    const submitOnEnter = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      workflow.enterName(field?.value ?? '');
      void workflow.submitEditor();
    };
    field?.addEventListener('keydown', submitOnEnter);
    return () => field?.removeEventListener('keydown', submitOnEnter);
  }, [editorSession.kind, editorMethodId, workflow]);
  const visible = methods
    .filter((method) =>
      method.name.toLocaleLowerCase(formatLocale).includes(query.trim().toLocaleLowerCase(formatLocale)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, formatLocale));
  const errorText = (context: 'read' | 'save' | 'remove') => {
    if (error === 'authorization-denied') return t('methods:library.errors.authorizationDenied');
    if (error === 'response-invalid') return t('methods:library.errors.responseInvalid');
    if (error === 'write-uncertain') return t('methods:library.errors.writeUncertain');
    if (context === 'remove') return t('methods:library.errors.removeRejected');
    if (context === 'save') return t('methods:library.errors.saveRejected');
    return t('methods:library.errors.readFailed');
  };
  return (
    <s-page inlineSize="large" heading={t('methods:index.title')}>
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        {t('admin-shell:shared.navigation.settings')}
      </s-link>
      <s-modal
        ref={removal}
        id="remove-method"
        size="small"
        heading={
          methods.find((m) => m.id === deleting?.methodId)?.name
            ? t('methods:library.removeHeading', {
                methodName: methods.find((m) => m.id === deleting?.methodId)?.name ?? '',
              })
            : t('methods:library.removeHeadingFallback')
        }
        onHide={() => workflow.closeRemoval()}
      >
        <s-stack gap="base">
          <s-paragraph>{t('methods:library.removeDescription')}</s-paragraph>
          {error && deleting && (
            <s-banner tone="critical" heading={t('methods:library.removeErrorHeading')}>
              <s-stack gap="base">
                <s-paragraph>{errorText('remove')}</s-paragraph>
                {!uncertain && (
                  <s-button onClick={() => void load()} disabled={busy}>
                    {t('methods:library.actions.reload')}
                  </s-button>
                )}
              </s-stack>
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          disabled={busy || transaction.read !== 'ready' || !deleting}
          onClick={() => void workflow.confirmRemoval()}
        >
          {uncertain ? t('methods:library.actions.retryRemoval') : t('methods:library.actions.remove')}
        </s-button>
        <s-button slot="secondary-actions" commandFor="remove-method" command="--hide" disabled={busy}>
          {t('common:actions.cancel')}
        </s-button>
      </s-modal>
      {(loading || methods.length > 0) && (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={busy || transaction.read !== 'ready' || uncertain}
          onClick={() => workflow.openCreate()}
        >
          {t('methods:library.actions.add')}
        </s-button>
      )}
      <s-modal
        ref={editor}
        id="edit-method"
        heading={
          transaction.editor.kind === 'rename' ? t('methods:library.renameHeading') : t('methods:library.addHeading')
        }
        size="small"
        onHide={() => workflow.closeEditor()}
      >
        <s-stack gap="base">
          {editing && !denied && (
            <s-text-field
              ref={nameField}
              label={t('methods:workflow.fields.name')}
              value={name}
              maxLength={80}
              disabled={busy || transaction.read !== 'ready' || uncertain}
              onInput={(event) => workflow.enterName(event.currentTarget.value)}
            />
          )}
          {!editing?.method && <s-paragraph color="subdued">{t('methods:library.nameExample')}</s-paragraph>}
          {error && editing && (
            <s-banner tone="critical" heading={t('methods:library.saveErrorHeading')}>
              <s-stack gap="base">
                <s-paragraph>{errorText('save')}</s-paragraph>
                {!uncertain && editing.method && (
                  <s-button onClick={() => void load()} disabled={busy}>
                    {t('methods:library.actions.reload')}
                  </s-button>
                )}
              </s-stack>
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={
            busy ||
            transaction.read !== 'ready' ||
            (!uncertain && (!name.trim() || name.trim() === editing?.method?.name))
          }
          onClick={() => void workflow.submitEditor()}
        >
          {uncertain
            ? t('methods:library.actions.retrySave')
            : editing?.method
              ? t('common:actions.save')
              : t('methods:library.actions.add')}
        </s-button>
        <s-button slot="secondary-actions" commandFor="edit-method" command="--hide" disabled={busy}>
          {t('common:actions.cancel')}
        </s-button>
      </s-modal>
      {error && (!uncertain || readFailed) && !editing && !deleting && (
        <s-banner
          tone="critical"
          heading={
            denied
              ? t('methods:library.errors.reopenHeading')
              : readFailed
                ? t('methods:library.errors.unavailableHeading')
                : t('methods:library.errors.updateHeading')
          }
        >
          <s-stack gap="base">
            <s-paragraph>{errorText(readFailed ? 'read' : 'save')}</s-paragraph>
            {readFailed && !denied && (
              <s-button disabled={busy || loading} onClick={() => void load()}>
                {t('common:actions.retry')}
              </s-button>
            )}
          </s-stack>
        </s-banner>
      )}
      {uncertain && !editing && !deleting && (
        <s-banner tone="warning" heading={t('methods:library.errors.checkLastChangeHeading')}>
          <s-stack gap="base">
            <s-paragraph>{t('methods:library.errors.checkLastChange')}</s-paragraph>
            <s-button disabled={busy || transaction.read !== 'ready'} onClick={() => void workflow.retry()}>
              {t('methods:library.actions.retryLastChange')}
            </s-button>
          </s-stack>
        </s-banner>
      )}
      {notice && (
        <s-banner tone="success">
          {notice === 'method-removed' ? t('methods:library.notices.removed') : t('methods:library.notices.saved')}
        </s-banner>
      )}
      {!denied && (loading || methods.length > 0 || !error) && (
        <s-section padding="none" accessibilityLabel={t('methods:index.region')}>
          {loading ? (
            <s-box padding="base">
              <AdminSkeleton variant="table" label={t('methods:library.loading')} />
            </s-box>
          ) : (
            !denied &&
            (methods.length ? (
              <div class="method-library-overview">
                <s-box padding="small">
                  <AdminIndexToolbar
                    id="method-library"
                    label={t('methods:index.search')}
                    value={query}
                    maxLength={80}
                    onInput={setQuery}
                    resultStatus={t('methods:index.counts.results', {
                      count: visible.length,
                      formattedCount: new Intl.NumberFormat(formatLocale).format(visible.length),
                    })}
                  />
                </s-box>
                {visible.length ? (
                  <AdminResourceTable label={t('methods:index.region')}>
                    <ResourceTableHead>
                      <ResourceTableHeader>{t('methods:index.columns.method')}</ResourceTableHeader>
                      <ResourceTableHeader>{t('methods:index.columns.actions')}</ResourceTableHeader>
                    </ResourceTableHead>
                    <ResourceTableBody>
                      {visible.map((method) => (
                        <ResourceTableRow key={method.id}>
                          <ResourceTableCell>
                            <s-text type="strong">{method.name}</s-text>
                          </ResourceTableCell>
                          <ResourceTableCell>
                            <div class="method-row-actions">
                              <s-button
                                commandFor={`method-actions-${method.id}`}
                                variant="tertiary"
                                icon="menu-horizontal"
                                accessibilityLabel={t('methods:index.actions.actionsForMethod', {
                                  methodName: method.name,
                                })}
                                disabled={busy || transaction.read !== 'ready' || uncertain}
                              />
                              <s-menu
                                id={`method-actions-${method.id}`}
                                accessibilityLabel={t('methods:index.actions.actionsForMethod', {
                                  methodName: method.name,
                                })}
                              >
                                <s-button icon="edit" onClick={() => workflow.openRename(method.id)}>
                                  {t('methods:library.actions.rename')}
                                </s-button>
                                <s-button icon="delete" tone="critical" onClick={() => workflow.openRemoval(method.id)}>
                                  {t('methods:library.actions.remove')}
                                </s-button>
                              </s-menu>
                            </div>
                          </ResourceTableCell>
                        </ResourceTableRow>
                      ))}
                    </ResourceTableBody>
                  </AdminResourceTable>
                ) : (
                  <s-box padding="large">
                    <s-empty-state heading={t('methods:index.empty.noMethodsFound')}>
                      <s-text slot="subheading">{t('methods:library.empty.searchDescription')}</s-text>
                      <s-button slot="primary-action" onClick={() => setQuery('')}>
                        {t('admin-shell:shared.search.clear')}
                      </s-button>
                    </s-empty-state>
                  </s-box>
                )}
              </div>
            ) : (
              !error && (
                <s-box padding="base">
                  <s-empty-state heading={t('methods:library.empty.noMethods')}>
                    <s-box slot="graphic" inlineSize="144px" maxInlineSize="144px" maxBlockSize="144px">
                      <s-image
                        src="/illustrations/shopify/empty-records.png"
                        alt=""
                        inlineSize="fill"
                        aspectRatio="1"
                        objectFit="contain"
                      />
                    </s-box>
                    <s-text slot="subheading">{t('methods:library.empty.noMethodsDescription')}</s-text>
                    <s-button
                      slot="primary-action"
                      variant="primary"
                      disabled={busy || transaction.read !== 'ready' || uncertain}
                      onClick={() => workflow.openCreate()}
                    >
                      {t('methods:library.actions.add')}
                    </s-button>
                  </s-empty-state>
                </s-box>
              )
            ))
          )}
        </s-section>
      )}
      {!loading && !denied && methods.length > 0 && (
        <s-box paddingBlockStart="base">
          <s-paragraph color="subdued">{t('methods:library.copyNote')}</s-paragraph>
        </s-box>
      )}
    </s-page>
  );
}

export default withAdminLocale(MethodLibrary);
