/** Node-side browser boundary double; no DOM or production implementation is supplied. */
export function replaceWindow(value: { shopify: { idToken(): Promise<string> } }): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value });
  return () => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  };
}
