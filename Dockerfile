# 构建阶段：安装生产依赖（playwright-core 为 devDependency，不会进入镜像）
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 运行阶段：仅携带运行时必需文件；SQLite 内置于 Node 24（node:sqlite），无原生编译
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 TZ=Asia/Shanghai

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY web ./web

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
