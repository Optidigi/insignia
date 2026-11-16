import { readCustomerEmailPrivateJson } from '../../../../worker/src/customer-artwork-email-profile.ts';

export type CustomerEmailQualification = {
  version: 'customer-artwork-email-qualification-v1';
  accountId: string;
  appOrigin: string;
  sender: 'noreply@insigniacustomizer.com';
  arbitraryRecipients: true;
  protectedOrderEmail: true;
  qualifiedAt: string;
  expiresAt?: string;
  providerEvidenceRef: string;
  recipientEvidenceRef: string;
  /** Explicit reviewed installations; empty when `allActiveInstallations` is set. */
  tenantScopes: { shopId: string; installationGeneration: string; appClientId: string }[];
  /**
   * Owner decision 16 Nov 2026 (public app): every currently active installation of this app is in scope.
   * The grant is still bound to this deployment's app client id; merchants opt out with their own setting.
   */
  allActiveInstallations: boolean;
};

/** The profile value that selects every active installation instead of an explicit list. */
export const ALL_ACTIVE_INSTALLATIONS = 'all-active-installations';

/**
 * The one scope check every customer-mode send path uses. A notice is in scope only while its exact
 * installation generation is the shop's current, active one (`isActiveInstallation`); in explicit mode
 * it must also be listed. A reinstalled or uninstalled generation is never in scope.
 */
export async function inQualifiedScope(
  approved: Pick<CustomerEmailQualification, 'tenantScopes' | 'allActiveInstallations'>,
  scope: { shopId: string; installationGeneration: string },
  isActiveInstallation: (scope: { shopId: string; installationGeneration: string }) => Promise<boolean>,
): Promise<boolean> {
  if (
    !approved.allActiveInstallations &&
    !approved.tenantScopes.some(
      (target) => target.shopId === scope.shopId && target.installationGeneration === scope.installationGeneration,
    )
  )
    return false;
  return isActiveInstallation(scope);
}
/** Operator-owned evidence selector. It must reference actual qualified provider/recipient observations. */
export async function loadCustomerEmailQualification(
  file: string,
  expected: { accountId: string; appOrigin: string; appClientId: string; artifactRoot?: string },
  clock: () => Date = () => new Date(),
): Promise<CustomerEmailQualification> {
  try {
    const raw = await readCustomerEmailPrivateJson(file, {
      artifactRoot: expected.artifactRoot ?? process.cwd(),
      maxBytes: 16384,
    });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
    const value = raw as Record<string, unknown>;
    const keys = [
      'version',
      'accountId',
      'appOrigin',
      'sender',
      'arbitraryRecipients',
      'protectedOrderEmail',
      'qualifiedAt',
      'providerEvidenceRef',
      'recipientEvidenceRef',
      'tenantScopes',
    ];
    if (
      keys.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !keys.includes(key) && key !== 'expiresAt') ||
      value.version !== 'customer-artwork-email-qualification-v1' ||
      value.accountId !== expected.accountId ||
      value.appOrigin !== new URL(expected.appOrigin).origin ||
      value.sender !== 'noreply@insigniacustomizer.com' ||
      value.arbitraryRecipients !== true ||
      value.protectedOrderEmail !== true ||
      typeof value.qualifiedAt !== 'string' ||
      (value.expiresAt !== undefined && typeof value.expiresAt !== 'string') ||
      typeof value.providerEvidenceRef !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value.providerEvidenceRef) ||
      typeof value.recipientEvidenceRef !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value.recipientEvidenceRef) ||
      (value.tenantScopes !== ALL_ACTIVE_INSTALLATIONS &&
        (!Array.isArray(value.tenantScopes) || !value.tenantScopes.length || value.tenantScopes.length > 100))
    )
      throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
    const from = Date.parse(value.qualifiedAt),
      now = +clock();
    if (!Number.isFinite(from) || !Number.isFinite(now) || from > now)
      throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
    if (value.expiresAt !== undefined) {
      const until = Date.parse(value.expiresAt as string);
      if (!Number.isFinite(until) || until <= now || until <= from)
        throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
    }
    const allActiveInstallations = value.tenantScopes === ALL_ACTIVE_INSTALLATIONS;
    const tenantScopes: CustomerEmailQualification['tenantScopes'] = [];
    for (const item of allActiveInstallations ? [] : (value.tenantScopes as unknown[])) {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
      const scope = item as Record<string, unknown>;
      if (
        Object.keys(scope).sort().join(',') !== 'appClientId,installationGeneration,shopId' ||
        typeof scope.shopId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(scope.shopId) ||
        typeof scope.installationGeneration !== 'string' ||
        !/^[1-9][0-9]{0,17}$/.test(scope.installationGeneration) ||
        scope.appClientId !== expected.appClientId
      )
        throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
      tenantScopes.push({
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        appClientId: expected.appClientId,
      });
    }
    return {
      version: value.version,
      accountId: expected.accountId,
      appOrigin: expected.appOrigin,
      sender: value.sender,
      arbitraryRecipients: true,
      protectedOrderEmail: true,
      qualifiedAt: value.qualifiedAt,
      ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
      providerEvidenceRef: value.providerEvidenceRef,
      recipientEvidenceRef: value.recipientEvidenceRef,
      tenantScopes,
      allActiveInstallations,
    };
  } catch {
    throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
  }
}
