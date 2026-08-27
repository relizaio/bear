FROM node:24.20.0-alpine3.23@sha256:0388af2af070cd4736a1567cfed02469ba117848845b4165d87a333edb53d2ca AS builder
RUN mkdir /app
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY ./ .
RUN npm run build
# Reduce to production dependencies for the runtime image (lockfile-exact)
RUN npm ci --omit=dev

FROM node:24.20.0-alpine3.23@sha256:0388af2af070cd4736a1567cfed02469ba117848845b4165d87a333edb53d2ca AS package
ARG CI_ENV=noci
ARG GIT_COMMIT=git_commit_undefined
ARG GIT_BRANCH=git_branch_undefined
ARG VERSION=not_versioned
# Pick up Alpine security fixes newer than the base image (e.g. openssl)
RUN apk upgrade --no-cache libcrypto3 libssl3
# The runtime only executes node; drop the bundled npm and yarn toolchains
# so their vendored dependencies stop surfacing in image scans
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
RUN mkdir /app && echo "version=$VERSION" > /app/version && echo "commit=$GIT_COMMIT" >> /app/version && echo "branch=$GIT_BRANCH" >> /app/version
WORKDIR /app
RUN addgroup -S apprunner && adduser -S apprunner -G apprunner && chown apprunner:apprunner -R /app
COPY --chown=apprunner:apprunner package*.json ./
COPY --from=builder --chown=apprunner:apprunner /app/node_modules ./node_modules
COPY --from=builder --chown=apprunner:apprunner /app/dist ./
COPY --chown=apprunner:apprunner src/schema.graphql /app/src/
COPY --chown=apprunner:apprunner migrations /app/migrations
USER apprunner

LABEL git_commit=$GIT_COMMIT
LABEL git_branch=$GIT_BRANCH
LABEL ci_environment=$CI_ENV
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.vendor="Reliza Incorporated"
LABEL org.opencontainers.image.title="BEAR Backend"
LABEL org.opencontainers.image.source="https://github.com/relizaio/bear"
LABEL org.opencontainers.image.license="AGPL-3.0-only"
LABEL org.opencontainers.image.base.name="registry.relizahub.com/library/bear-backend"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.url="https://rearmhq.com"

EXPOSE 4002

CMD ["node", "/app/src/main.js"]
