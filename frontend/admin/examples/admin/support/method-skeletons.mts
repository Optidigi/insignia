import { createAdminTranslator } from '@insignia/ui-localization/admin';

/** Static loading decoration is independent of component registration. */
function bar(width: `${number}px` | '100%', height: `${number}px`) {
  return `<div class="admin-skeleton-bar" style="width:${width};height:${height}"><div data-skeleton-part="bar" data-skeleton-height="${height}" class="admin-skeleton-fill"></div></div>`;
}

/** Preview-only loading shells for the local Methods routes. */
type SkeletonTextKey =
  | 'methods:index.region'
  | 'methods:library.loading'
  | 'admin-shell:loading.methods'
  | `methods:index.columns.${'method' | 'pricing' | 'productsUsing' | 'productSetup' | 'actions'}`;
function skeletonText(locale: string) {
  const { t } = createAdminTranslator(locale, { allowPseudoLocale: locale === 'en-XA' });
  return (key: SkeletonTextKey) => {
    const value = t(key);
    return value.replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
    );
  };
}

export function methodIndexSkeletonMarkup(locale = 'en') {
  const text = skeletonText(locale);
  const rows = Array.from(
    { length: 5 },
    () => `
      <tr>
        <td><div class="method-index-identity">${bar('16px', '16px')}<div class="method-index-copy">
          <div class="admin-skeleton-text-line">${bar('150px', '16px')}</div>
          <dl class="method-index-mobile-details">
            ${Array.from({ length: 4 }, () => `<dt><div class="admin-skeleton-text-line">${bar('88px', '12px')}</div></dt><dd><div class="admin-skeleton-text-line">${bar('68px', '12px')}</div></dd>`).join('')}
          </dl>
        </div></div></td>
        <td>${bar('96px', '16px')}</td>
        <td>${bar('120px', '16px')}</td>
        <td>${bar('88px', '16px')}</td>
        <td>${bar('20px', '20px')}</td>
      </tr>`,
  ).join('');
  return `
    <div data-skeleton-container>
      <div class="admin-skeleton-grid" style="justify-items:center">
        <div class="admin-skeleton-box" data-skeleton-layout="table" data-skeleton-width="large" aria-label="${text('methods:index.region')}"
          style="max-width:100%;width:100%;padding:16px">
          <div role="status" aria-label="${text('methods:library.loading')}" aria-busy="true"
            data-method-index-skeleton data-admin-skeleton>
            <div aria-hidden="true" inert>
              <div class="admin-skeleton-stack" data-skeleton-gap="base">
                <div class="admin-skeleton-box" style="border:1px solid #e3e3e3;border-radius:12px;padding:6px">
                  <div class="admin-skeleton-grid" data-skeleton-toolbar data-skeleton-gap="base" style="grid-template-columns:64px minmax(0,1fr) 24px;align-items:center">
                    ${bar('48px', '24px')}
                    ${bar('100%', '32px')}
                    ${bar('20px', '20px')}
                  </div>
                </div>
                <div class="method-index-table" data-resource-table aria-busy="true">
                  <div class="resource-table-scroll">
                    <table class="admin-resource-table" aria-label="${text('methods:index.region')}" inert>
                      <thead>
                        <tr>
                          <th scope="col"><div class="resource-table-heading-content"><div class="method-index-identity">${bar('16px', '16px')}<span>${text('methods:index.columns.method')}</span></div></div></th>
                          <th scope="col"><div class="resource-table-heading-content"><span>${text('methods:index.columns.pricing')}</span></div></th>
                          <th scope="col"><div class="resource-table-heading-content"><span>${text('methods:index.columns.productsUsing')}</span></div></th>
                          <th scope="col"><div class="resource-table-heading-content"><span>${text('methods:index.columns.productSetup')}</span></div></th>
                          <th scope="col"><div class="resource-table-heading-content"><span>${text('methods:index.columns.actions')}</span></div></th>
                        </tr>
                      </thead>
                      <tbody>${rows}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

export function methodDetailSkeletonMarkup(locale = 'en') {
  const text = skeletonText(locale);
  const line = (width: `${number}px` | '100%', height: `${number}px` = '12px', className = '') =>
    `<div class="admin-skeleton-text-line ${className}">${bar(width, height)}</div>`;
  const section = (heading: `${number}px`, contents: string) =>
    `<div class="admin-skeleton-section"><div class="admin-skeleton-section-heading">${bar(heading, '16px')}</div><div class="admin-skeleton-card" data-skeleton-card style="padding:16px">${contents}</div></div>`;
  return `
    <div data-skeleton-container>
      <div class="admin-skeleton-grid" style="justify-items:center">
        <div class="admin-skeleton-box" data-skeleton-layout="detail" data-skeleton-width="large" aria-label="${text('methods:index.region')}"
          style="max-width:100%;width:100%;padding:16px">
          <div role="status" aria-label="${text('admin-shell:loading.methods')}" aria-busy="true"
            data-method-detail-skeleton data-admin-skeleton>
            <div aria-hidden="true" inert>
              <div class="method-detail-layout">
                <div class="method-main-column">
                  ${section(
                    '120px',
                    `<div class="admin-skeleton-stack" data-skeleton-gap="base">
                    <div class="admin-skeleton-field">${line('130px', '16px')}${bar('100%', '32px')}${line('300px', '12px', 'method-skeleton-name-help')}</div>
                    <div class="admin-skeleton-field">${line('160px', '16px')}${bar('100%', '80px')}${line('240px')}</div>
                  </div>`,
                  )}
                  ${section(
                    '120px',
                    `<div class="admin-skeleton-stack" data-skeleton-gap="base">
                    ${line('100%', '12px', 'method-skeleton-pricing-intro')}
                    <div class="admin-skeleton-choice">${bar('16px', '16px')}<div class="admin-skeleton-choice-copy">${line('120px', '16px')}${line('100%', '12px', 'method-skeleton-choice-description')}</div></div>
                    <div class="admin-skeleton-choice">${bar('16px', '16px')}<div class="admin-skeleton-choice-copy">${line('170px', '16px')}${line('100%', '12px', 'method-skeleton-choice-description')}</div></div>
                    <div class="method-skeleton-dependent-controls">${bar('100%', '56px')}</div>
                  </div>`,
                  )}
                  ${section(
                    '160px',
                    `<div class="admin-skeleton-stack" data-skeleton-gap="base">
                    <div class="admin-skeleton-choice">${bar('16px', '16px')}<div class="admin-skeleton-choice-copy">${line('140px', '16px')}${line('100%', '12px', 'method-skeleton-choice-description')}</div></div>
                    <div class="admin-skeleton-choice">${bar('16px', '16px')}<div class="admin-skeleton-choice-copy">${line('120px', '16px')}${line('100%', '12px', 'method-skeleton-choice-description')}</div></div>
                    <div class="method-skeleton-dependent-controls">${bar('100%', '56px')}</div>
                  </div>`,
                  )}
                </div>
                <div class="method-summary">
                  <div class="admin-skeleton-stack" data-skeleton-gap="base">
                    ${line('90px', '16px')}
                    ${line('120px')}
                    ${line('100%')}
                    <div class="admin-skeleton-divider"></div>
                    ${line('100px')}
                    ${line('100%')}
                    ${line('130px')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}
