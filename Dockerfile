# Generic image for any HireFlow backend service.
#   docker build --build-arg SERVICE=jobs -t hireflow-jobs .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --no-audit --no-fund --ignore-scripts=false
ARG SERVICE
RUN test -n "$SERVICE" && npm run build -w services/${SERVICE}
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
ARG SERVICE
ENV SERVICE=${SERVICE}
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services/${SERVICE}/package.json ./services/${SERVICE}/package.json
COPY --from=build /app/services/${SERVICE}/dist ./services/${SERVICE}/dist
USER node
CMD ["sh", "-c", "node services/${SERVICE}/dist/index.js"]
