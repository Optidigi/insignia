import type { IncomingMessage, ServerResponse } from 'node:http';
import { ArtworkInspectionError } from './errors.js';
import type { inspectArtwork } from './inspection.js';
import { decodeInspectionResult, INSPECTION_INPUT_LIMIT } from './inspection-wire.js';

/** Private byte-only RPC. One caller occupies the slot until the decoder actually settles.
 * No URLs, object keys, credentials, storage writes, queue jobs or automatic retries. */
export function createPrivateInspectionHandler(input: { inspect?: typeof inspectArtwork; ready(): boolean }) {
  let active: Promise<void> | undefined;
  let stopping = false;
  let controller: AbortController | undefined;
  return {
    handle(request: IncomingMessage, response: ServerResponse) {
      const reply = (status: number, body?: unknown) => {
        response.setHeader('connection', 'close');
        if (!response.destroyed)
          response
            .writeHead(status, { 'content-type': 'application/json' })
            .end(body ? JSON.stringify(body) : undefined);
      };
      if (request.method !== 'POST' || request.url !== '/merchant-preview-inspect') return reply(404);
      const inspect = input.inspect;
      if (!inspect || stopping || active || !input.ready()) return reply(503);
      if (request.headers['content-type'] !== 'application/octet-stream' || request.headers['content-encoding'])
        return reply(415);
      const length = request.headers['content-length'];
      if (!length || !/^[1-9][0-9]{0,7}$/.test(length) || request.headers['transfer-encoding']) return reply(400);
      const expected = Number(length);
      if (expected > INSPECTION_INPUT_LIMIT) return reply(413);
      const aborter = new AbortController();
      controller = aborter;
      const abort = () => aborter.abort();
      request.once('aborted', abort);
      const disconnected = () => {
        if (!response.writableFinished) abort();
      };
      response.once('close', disconnected);
      const timer = setTimeout(() => {
        abort();
        response.destroy();
        request.destroy();
      }, 12_000);
      const work = async () => {
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > expected || aborter.signal.aborted) throw new Error('Invalid inspection input');
            chunks.push(Buffer.from(chunk));
          }
          if (size !== expected || !request.complete || aborter.signal.aborted)
            throw new Error('Incomplete inspection input');
          const original = Buffer.concat(chunks);
          const result = await inspect(original, { signal: aborter.signal });
          if (aborter.signal.aborted) return;
          if (result.preview.byteLength > 2 * 1024 * 1024) throw new Error('Invalid inspection preview');
          const validated = decodeInspectionResult(
            { ...result, preview: Buffer.from(result.preview).toString('base64') },
            original,
          );
          reply(200, { ...validated, preview: Buffer.from(validated.preview).toString('base64') });
        } catch (error) {
          if (!aborter.signal.aborted)
            reply(error instanceof ArtworkInspectionError && error.code === 'REJECTED' ? 422 : 503);
        } finally {
          clearTimeout(timer);
          request.off('aborted', abort);
          response.off('close', disconnected);
          controller = undefined;
        }
      };
      active = work().finally(() => {
        active = undefined;
      });
    },
    async stop() {
      stopping = true;
      controller?.abort();
      await active;
    },
  };
}
