FROM node:24-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
WORKDIR /src
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY runtime ./runtime
COPY scripts ./scripts
COPY bin ./bin
COPY LICENSE ./
RUN npm ci
RUN PATH="/root/.local/bin:$PATH" npm run runtime:build
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/MadsGao/frakio-work"
WORKDIR /opt/frakio-work
COPY --from=build /src/apps/api ./apps/api
COPY --from=build /src/bin ./bin
COPY --from=build /src/dist ./dist
COPY --from=build /src/runtime ./runtime
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json /src/LICENSE ./
ENV FRAKIO_WORK_DEPLOYMENT_MODE=managed-web \
    FRAKIO_WORK_PACKAGED=1 \
    FRAKIO_WORK_HOME=/data \
    FRAKIO_WORK_APP_ROOT=/opt/frakio-work \
    FRAKIO_WORK_WEB_DIST=/opt/frakio-work/dist \
    FRAKIO_WORK_RUNTIME_HOME=/opt/frakio-work/runtime \
    FRAKIO_WORK_PROJECTS_ROOT=/workspace \
    HERMES_HOME=/data/hermes \
    PORT=8787
VOLUME ["/data", "/workspace"]
EXPOSE 8787
CMD ["node", "apps/api/server.mjs"]
