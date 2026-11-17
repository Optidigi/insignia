type Bridge = { saveBar?: { hide(id: string): Promise<unknown> } };

/**
 * A deliberate exit once the draft is saved or discarded. Shopify asks before leaving while its save bar is
 * shown and keeps a modal's backdrop until that modal is hidden, so retire both before the page starts to unload:
 * close the open dialog, finish hiding the save bar, then disarm the page's own leave guard and navigate.
 */
export async function leavePage({
  href,
  saveBarId,
  closeDialog,
  disarm,
}: {
  href: string;
  saveBarId: string;
  closeDialog?(): void;
  disarm(): void;
}): Promise<void> {
  closeDialog?.();
  // Let a dialog closed by this or the preceding transition unmount; it hides its Shopify overlay as it does.
  await new Promise((resolve) => setTimeout(resolve));
  try {
    await (window as unknown as { shopify?: Bridge }).shopify?.saveBar?.hide(saveBarId);
  } catch {
    // An unavailable host save bar cannot ask to stay either.
  }
  disarm();
  location.assign(href);
}
