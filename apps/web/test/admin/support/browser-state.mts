/** Explicit state installed by these browser fixtures; not a production App Bridge declaration. */
export {};

declare global {
  interface Window {
    shopify: {
      idToken(): Promise<string>;
      config?: { shop: string };
      loading?(active: boolean): void;
      scopes?: {
        query(): Promise<{ granted: string[]; required: string[]; optional: string[] }>;
        request(
          scopes: string[],
        ): Promise<{ result?: string; detail?: { granted: string[]; required: string[]; optional: string[] } }>;
      };
      saveBar?: {
        show(id: string): Promise<unknown>;
        hide(id: string): Promise<unknown>;
        leaveConfirmation?(): Promise<void>;
      };
    };
    syntheticTokenCount: number;
    __tokenCount: number;
    __tokenCalls: number;
    __releaseInitialToken: () => void;
    scopeQueries: number;
    scopeRequests: string[][];
    saveBarEvents: [string, string][];
    revoked: string[];
    erasurePrivacyGap: boolean;
    show(src: string | null): void;
  }
}
