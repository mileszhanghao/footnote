# Build the React UI and the TypeScript server, then run one Node process
# that serves both the API and the static UI.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The in-browser demo imports server/src modules, so the type check needs them.
COPY server/src /server/src
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=5001 WEB_DIST_DIR=/app/web
COPY --from=server /server/node_modules ./node_modules
COPY --from=server /server/dist ./dist
COPY --from=server /server/package.json ./
COPY --from=web /web/dist ./web
USER node
EXPOSE 5001
CMD ["node", "dist/index.js"]
