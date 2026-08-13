# Сборки нет: Node исполняет TypeScript напрямую, а рантайм-зависимостей у сервиса
# ноль. Поэтому образ — это Node плюс исходники, без стадии компиляции и без
# node_modules в проде.
FROM node:22-alpine

# flock из util-linux: без него run-cycle.sh не сможет защититься от наложения
# прогонов, а в базовом образе Alpine его нет.
RUN apk add --no-cache util-linux tzdata

# Сроки в извещениях московские, и вывод дедлайнов форматируется по Москве.
# Пусть время контейнера совпадает, чтобы логи читались без пересчёта в уме.
ENV TZ=Europe/Moscow

WORKDIR /app

# devDependencies нужны только для tsc и тестов — в образ они не едут.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY deploy ./deploy
RUN chmod +x deploy/run-cycle.sh

# База лежит в томе: контейнер пересоздаётся при обновлении, а накопленная
# история продаж и кэш реестров — самое ценное, что есть у сервиса.
ENV RADAR_DB=/data/radar.db
VOLUME ["/data"]

# Непривилегированный пользователь. Тому нужен владелец, иначе запись упадёт.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "src/cli.ts"]
CMD ["help"]
