# Public base identity matches existing reviewed ordinary worker packaging.
FROM node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /srv/insignia/verifier
RUN chown node:node /srv/insignia/verifier && chmod 0700 /srv/insignia/verifier
COPY --chown=node:node verifier-package/ ./
USER node
ENV NODE_ENV=production
ENTRYPOINT ["/srv/insignia/verifier/bin/node", "/srv/insignia/verifier/deployment/release-verifier/bootstrap.mts"]
CMD []
