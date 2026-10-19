# Public base identity matches existing reviewed ordinary worker packaging.
FROM node:24.21.0-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd
WORKDIR /srv/insignia/verifier
RUN chown node:node /srv/insignia/verifier && chmod 0700 /srv/insignia/verifier
COPY --chown=node:node verifier-package/ ./
USER node
ENV NODE_ENV=production
ENTRYPOINT ["/srv/insignia/verifier/bin/node", "/srv/insignia/verifier/deployment/release-verifier/bootstrap.mts"]
CMD []
