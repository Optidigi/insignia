FROM node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530

WORKDIR /srv/insignia
COPY --chown=node:node runtime/ ./
COPY --chmod=0555 tools/dbmate /usr/local/bin/dbmate
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
