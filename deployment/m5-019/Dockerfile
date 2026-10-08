FROM node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd

WORKDIR /srv/insignia
COPY --chown=node:node runtime/ ./
COPY --chmod=0555 tools/dbmate /usr/local/bin/dbmate
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
