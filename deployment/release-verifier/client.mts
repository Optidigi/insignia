// CUSTOM official session seeding. No lazy default-auth initialization is allowed.
export async function existingClient<T>({
  authenticate,
  getClient,
}: {
  authenticate(input: { noPrompt: true }): Promise<unknown>;
  getClient(): T;
}) {
  const result = await authenticate({ noPrompt: true });
  if (
    !result ||
    typeof result !== 'object' ||
    !('appManagementToken' in result) ||
    !('businessPlatformToken' in result) ||
    !('userId' in result) ||
    typeof result.appManagementToken !== 'string' ||
    !result.appManagementToken ||
    typeof result.businessPlatformToken !== 'string' ||
    !result.businessPlatformToken ||
    typeof result.userId !== 'string' ||
    !result.userId
  )
    throw Error('OFFICIAL_AUTH_RESULT_INVALID');
  // Tokens and user ID come solely from the official noPrompt result, never raw cache.
  // Account information is deliberately unobserved; this is an internal SDK sentinel.
  const session = {
    token: result.appManagementToken,
    businessPlatformToken: result.businessPlatformToken,
    userId: result.userId,
    accountInfo: { type: 'UnknownAccount' },
  };
  const original: unknown = getClient();
  if (!original || (typeof original !== 'object' && typeof original !== 'function') || !('constructor' in original))
    throw Error('OFFICIAL_CLIENT_CONSTRUCTOR_INVALID');
  const Constructor: unknown = original.constructor;
  if (
    !Constructor ||
    (typeof Constructor !== 'function' && typeof Constructor !== 'object') ||
    !('getInstance' in Constructor) ||
    !('resetInstance' in Constructor)
  )
    throw Error('OFFICIAL_CLIENT_CONSTRUCTOR_INVALID');
  if (typeof Constructor.getInstance !== 'function' || typeof Constructor.resetInstance !== 'function')
    throw Error('OFFICIAL_CLIENT_CONSTRUCTOR_INVALID');
  Constructor.resetInstance();
  const client: unknown = Constructor.getInstance(session);
  const seeded = getClient();
  if (seeded !== client) throw Error('OFFICIAL_GETTER_BINDING_INVALID');
  return seeded;
}
