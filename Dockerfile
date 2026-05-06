FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build
RUN npm prune --production
EXPOSE 3001
CMD ["node", "server.js"]
