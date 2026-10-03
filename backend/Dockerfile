FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma/schema.prisma prisma/schema.prisma
RUN npm install
COPY src src
COPY scripts scripts
COPY tsconfig.json .
COPY prisma/migrations prisma/migrations
RUN npx prisma generate && npm run build && npm prune --omit=dev
ENV PORT=3001
EXPOSE 3001
CMD ["node", "scripts/start.cjs"]
