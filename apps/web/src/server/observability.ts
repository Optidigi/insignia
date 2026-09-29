import { createObservability } from '@insignia/observability';

/** One registry per web process, shared by ingress and its protected scrape route. */
export const webObservability = createObservability();
