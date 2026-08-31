FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/marketplace.sqlite
EXPOSE 3000
CMD ["node","src/server.js"]
