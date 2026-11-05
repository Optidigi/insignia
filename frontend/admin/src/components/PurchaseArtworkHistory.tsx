import type { PurchaseView } from '@insignia/contracts';
import { useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import AdminDisclosure from './AdminDisclosure';
import OriginalArtworkDownload from './OriginalArtworkDownload';

/** Keep long histories navigable without mounting every download control at once. */
export default function PurchaseArtworkHistory({
  purchase,
  deny,
}: {
  purchase: PurchaseView;
  deny(error: unknown): void;
}) {
  const { t, formatLocale } = useAdminLocale();
  const [limit, setLimit] = useState(20);
  const events = purchase.artworkEvents
    .filter((event) => event.kind === 'ATTACH')
    .sort((a, b) => b.version - a.version);
  if (!events.length) return null;
  const number = new Intl.NumberFormat(formatLocale);
  const date = (value: string) =>
    t('orders:artworkHistory.dateUtc', {
      date: new Intl.DateTimeFormat(formatLocale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
        new Date(value),
      ),
    });
  return (
    <s-section heading={t('orders:artworkHistory.heading')}>
      <s-icon slot="graphic" type="clock" />
      <AdminDisclosure
        label={t('orders:artworkHistory.view', {
          formattedCount: number.format(events.length),
        })}
      >
        <div class="admin-record-id">
          <s-stack gap="base">
            {events.slice(0, limit).map((event, index) => {
              const group = purchase.groups.find((item) => item.index === event.groupIndex);
              const product = group
                ? purchase.lines.find((line) => line.productId === group.productId)?.title
                : undefined;
              const designs = group ? purchase.groups.filter((item) => item.productId === group.productId) : [];
              const design =
                designs.length > 1
                  ? t('orders:artworkHistory.design', {
                      designNumber: number.format(designs.findIndex((item) => item.index === group?.index) + 1),
                    })
                  : undefined;
              const placement = group?.placements.find((item) => item.id === event.placementId);
              const location = placement
                ? (group?.presentation?.labels.placements?.[placement.id] ??
                  t('orders:artworkHistory.placement', {
                    placementNumber: number.format((group?.placements.indexOf(placement) ?? 0) + 1),
                  }))
                : undefined;
              return (
                <s-stack key={event.eventId} gap="small">
                  {index > 0 && <s-divider />}
                  <s-stack direction="inline" gap="small">
                    <s-text type="strong">{t('orders:artworkHistory.attached')}</s-text>
                    <s-text color="subdued">
                      {t('orders:artworkHistory.version', {
                        version: number.format(event.version),
                      })}
                    </s-text>
                  </s-stack>
                  {event.kind === 'ATTACH' && (product || location) && (
                    <s-text>{[product, design, location].filter(Boolean).join(' · ')}</s-text>
                  )}
                  {event.erasedAt ? (
                    <s-text color="subdued">{t('orders:artworkHistory.erased')}</s-text>
                  ) : (
                    event.expiresAt && (
                      <s-text color="subdued">
                        {t('orders:artworkHistory.originalAvailableUntil', {
                          date: date(event.expiresAt),
                        })}
                      </s-text>
                    )
                  )}
                  {event.kind === 'ATTACH' &&
                    event.assetId &&
                    !event.erasedAt &&
                    event.expiresAt &&
                    Date.parse(event.expiresAt) > Date.now() && (
                      <OriginalArtworkDownload purchaseId={purchase.purchaseId} assetId={event.assetId} deny={deny} />
                    )}
                </s-stack>
              );
            })}
            {events.length > limit && (
              <s-button onClick={() => setLimit((value) => value + 20)}>{t('orders:artworkHistory.showMore')}</s-button>
            )}
          </s-stack>
        </div>
      </AdminDisclosure>
    </s-section>
  );
}
