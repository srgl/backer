FROM node:12-alpine

RUN apk --no-cache add ca-certificates rsync e2fsprogs util-linux && \
  wget https://github.com/restic/restic/releases/download/v0.9.5/restic_0.9.5_linux_amd64.bz2 && \
  bunzip2 restic_0.9.5_linux_amd64.bz2 && \
  mv restic_0.9.5_linux_amd64 /usr/bin/restic && \
  chmod a+x /usr/bin/restic

WORKDIR /app
COPY package*.json ./
RUN npm install --no-optional --only=production
COPY . .
