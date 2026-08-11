FROM golang:1.24.8-alpine3.22 AS build
RUN apk add --no-cache bash git
WORKDIR /src
RUN git clone --filter=blob:none https://github.com/minio/minio.git . \
    && git checkout --detach 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a
RUN CGO_ENABLED=0 go build -tags kqueue -trimpath \
    --ldflags "$(go run buildscripts/gen-ldflags.go)" -o /out/minio .

FROM alpine:3.22.2
RUN apk add --no-cache ca-certificates
COPY --from=build /out/minio /usr/local/bin/minio
ENTRYPOINT ["minio"]
CMD ["server", "/data"]
