FROM node:20-alpine

RUN apk add --no-cache python3 g++ openjdk17

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
ENV PATH="$JAVA_HOME/bin:${PATH}"

WORKDIR /sandbox

COPY package*.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 8000

CMD ["node", "server.js"]