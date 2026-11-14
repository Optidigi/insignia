/** The photo is stored on the server, but this browser could not read its private preview back. */
export class StoredPreviewUnreadableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Stored preview unreadable', options);
  }
}
