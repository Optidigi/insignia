import { startServer } from '@astrojs/node/server.js';

/**
 * Built server entry (`dist/server/entry.mjs`). The adapter's own autostart drops a listen failure: its process-wide
 * unhandledRejection handler ignores rejections outside a request, so an occupied port used to exit 0 silently.
 * The adapter is therefore built without autostart and this module starts the same standalone server itself.
 */
const LISTEN_ERRORS = ['EADDRINUSE', 'EADDRNOTAVAIL', 'EACCES'] as const;

const { server, done } = startServer();
done.catch(async (error: unknown) => {
  // Only a failed bind is fatal; any later server error keeps the adapter's existing behavior.
  if (server.server.listening) return;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const errorClass = LISTEN_ERRORS.find((known) => known === code) ?? 'LISTEN_FAILED';
  const { webObservability } = await import('./observability.js');
  webObservability.logger.error('web_listen_failed', { errorClass });
  process.exitCode = 1;
});
