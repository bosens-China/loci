FROM node:24-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --prod --frozen-lockfile --filter @loci/server... --ignore-scripts

FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV LOCI_DATA_DIR=/data
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=dependencies /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=dependencies /app/packages/shared/node_modules ./packages/shared/node_modules

# 依赖与浏览器分层，下载中断后重建可直接复用系统依赖层。
RUN node /app/apps/server/node_modules/playwright-core/cli.js install-deps chromium

# 只安装无界面的 Chromium shell；服务端仅执行 JavaScript 并读取 HTML。
RUN node /app/apps/server/node_modules/playwright-core/cli.js install --only-shell chromium \
    && chmod -R 755 /ms-playwright

# 应用源码最后复制，普通代码修改不会让浏览器依赖缓存失效。
COPY apps/server/package.json ./apps/server/package.json
COPY apps/server/src ./apps/server/src
COPY packages/core/package.json ./packages/core/package.json
COPY packages/core/src ./packages/core/src
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/src ./packages/shared/src

WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
