FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs local-ai.mjs ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3000 AI_PROVIDER=cloud DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server.mjs"]
