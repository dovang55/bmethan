FROM node:20-alpine

WORKDIR /app

# Installe les dépendances Node
COPY server/package*.json ./server/
RUN cd server && npm install --production

# Copie tout le projet (HTML, assets, server)
COPY . .

# Dossier temporaire pour les uploads
RUN mkdir -p server/tmp

EXPOSE 3000

CMD ["node", "server/index.js"]
