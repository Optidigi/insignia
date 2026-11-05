import type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
import { useId, useState } from 'preact/hooks';
import PurchaseHistoricalPreview from '../islands/PurchaseHistoricalPreview';
import { useAdminLocale } from '../shared/admin-i18n.js';
import AdminSkeleton from './AdminSkeleton';

interface PurchaseDesignPreviewProps {
  purchaseId: string;
  group: PurchaseGroup;
  lines: PurchaseView['lines'];
  deny: (error: unknown) => void;
  disabled: boolean;
}

/** Mount a single preview only while the merchant is viewing the design. */
export default function PurchaseDesignPreview({
  purchaseId,
  group,
  lines,
  deny,
  disabled,
}: PurchaseDesignPreviewProps) {
  const { t } = useAdminLocale();
  const modalId = useId();
  const [open, setOpen] = useState(false);
  const hasReplacement = group.placements.some(
    (placement) =>
      placement.currentAssetId &&
      (placement.originalArtwork.kind === 'deferred' ||
        placement.currentAssetId !== placement.originalArtwork.revisionId),
  );
  const [artworkSource, setArtworkSource] = useState<'current' | 'purchased'>(hasReplacement ? 'current' : 'purchased');

  const expired = Date.parse(group.payloadExpiresAt) <= Date.now();
  if (!group.geometry || expired)
    return (
      <>
        <s-text color="subdued" interestFor={`${modalId}-unavailable`}>
          {expired ? t('orders:designPreview.expired') : t('orders:designPreview.unavailable')}
        </s-text>
        <s-tooltip id={`${modalId}-unavailable`}>
          {expired ? t('orders:designPreview.expiredDetails') : t('orders:designPreview.unavailableDetails')}
        </s-tooltip>
      </>
    );

  return (
    <>
      <s-button variant="secondary" icon="image" commandFor={modalId} command="--show" disabled={disabled}>
        {t('orders:designPreview.view')}
      </s-button>
      <s-modal
        id={modalId}
        heading={t('orders:designPreview.heading')}
        size="base"
        onShow={() => {
          setArtworkSource(hasReplacement ? 'current' : 'purchased');
          setOpen(true);
        }}
        onHide={() => setOpen(false)}
      >
        <s-stack gap="base">
          {hasReplacement && (
            <s-select
              label={t('orders:designPreview.artworkVersion')}
              value={artworkSource}
              disabled={disabled}
              onChange={(event) => {
                const source = event.currentTarget.value;
                if (source === 'current' || source === 'purchased') setArtworkSource(source);
              }}
            >
              <s-option value="current">{t('orders:designPreview.currentArtwork')}</s-option>
              <s-option value="purchased">{t('orders:designPreview.atPurchase')}</s-option>
            </s-select>
          )}
          {open &&
            (disabled ? (
              <AdminSkeleton label={t('orders:designPreview.refreshing')} rows={2} variant="preview" />
            ) : (
              <PurchaseHistoricalPreview
                key={artworkSource}
                purchaseId={purchaseId}
                group={group}
                lines={lines}
                deny={deny}
                artworkSource={artworkSource}
              />
            ))}
        </s-stack>
        <s-button slot="primary-action" variant="primary" commandFor={modalId} command="--hide">
          {t('common:actions.done')}
        </s-button>
      </s-modal>
    </>
  );
}
