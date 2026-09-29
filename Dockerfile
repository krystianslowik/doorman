FROM --platform=linux/amd64 node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM --platform=linux/amd64 node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM --platform=linux/amd64 node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=linux/amd64 node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3851
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY data/free.txt data/disposable.txt ./data/
COPY package.json ./
USER node
EXPOSE 3851
CMD ["node", "dist/server.js"]
