# Build candidate only. No container/image runtime proof exists in M5-024.
FROM node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd
WORKDIR /srv/insignia/worker
COPY --chown=node:node worker-package/ ./
USER node
ENV NODE_ENV=production
CMD ["/usr/local/bin/node", "/srv/insignia/worker/dist/main.js"]
