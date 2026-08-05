FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --filter @loci/server... --ignore-scripts

COPY apps/server apps/server
COPY packages/core packages/core
RUN pnpm --filter @loci/core build && pnpm --filter @loci/server build

FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV LOCI_DATA_DIR=/data
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/packages/core ./packages/core

# 依赖与浏览器分层，下载中断后重建可直接复用系统依赖层。
RUN node /app/apps/server/node_modules/playwright-core/cli.js install-deps chromium

# 只安装无界面的 Chromium shell；服务端仅执行 JavaScript 并读取 HTML。
RUN node /app/apps/server/node_modules/playwright-core/cli.js install --only-shell chromium \
    && chmod -R 755 /ms-playwright

WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
