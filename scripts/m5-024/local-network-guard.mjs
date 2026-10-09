// Test-only process transport guard. Uninstall local work needs no provider requests.
globalThis.fetch = async () => {
  throw new Error('external_requests_denied_in_local_test');
};
