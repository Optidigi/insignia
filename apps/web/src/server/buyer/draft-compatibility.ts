import type { BuyerDraftGroup } from '@insignia/contracts';
import { type PublishedConfig, validateCustomizationDraft } from '@insignia/domain';

export type DraftCompatibility = 'current' | 'publication-changed' | 'choice-unavailable' | 'configuration-unavailable';

/**
 * Whether a saved draft's choices are still offered by the product's current publication. A draft may have no
 * sizes or colours yet (#366); its placements and options are checked exactly as a quote checks them.
 */
export function draftCompatibility(
  shopId: string,
  draft: BuyerDraftGroup,
  current: PublishedConfig | null,
): DraftCompatibility {
  if (!current) return 'configuration-unavailable';
  try {
    validateCustomizationDraft(
      {
        ...draft,
        shopId,
        version: 'm2-customization-group-v1',
        configRevisionId: current.revisionId,
        revisionContentHash: current.revisionContentHash,
      },
      current,
    );
  } catch {
    return 'choice-unavailable';
  }
  return current.revisionId === draft.configRevisionId ? 'current' : 'publication-changed';
}
