FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm install
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
RUN npm run build -w @nepal-hand-pay/shared-types && npm run build -w @nepal-hand-pay/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/shared-types ./packages/shared-types
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
