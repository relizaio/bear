FROM node:24.14.1-alpine3.23@sha256:01743339035a5c3c11a373cd7c83aeab6ed1457b55da6a69e014a95ac4e4700b AS builder
RUN mkdir /app
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY ./ .
RUN npm run build

FROM node:24.14.1-alpine3.23@sha256:01743339035a5c3c11a373cd7c83aeab6ed1457b55da6a69e014a95ac4e4700b AS package
ARG CI_ENV=noci
ARG GIT_COMMIT=git_commit_undefined
ARG GIT_BRANCH=git_branch_undefined
ARG VERSION=not_versioned
RUN mkdir /app && echo "version=$VERSION" > /app/version && echo "commit=$GIT_COMMIT" >> /app/version && echo "branch=$GIT_BRANCH" >> /app/version
WORKDIR /app
RUN addgroup -S apprunner && adduser -S apprunner -G apprunner && chown apprunner:apprunner -R /app
COPY --chown=apprunner:apprunner package*.json ./
COPY --from=builder --chown=apprunner:apprunner /app/dist ./
COPY --chown=apprunner:apprunner src/schema.graphql /app/src/
COPY --chown=apprunner:apprunner migrations /app/migrations
USER apprunner
RUN npm install --omit=dev

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