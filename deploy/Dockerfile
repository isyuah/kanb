# syntax: docker/dockerfile:1
# 二进制在本地交叉编译（GOOS=linux GOARCH=amd64 CGO_ENABLED=0），镜像只做拷贝
FROM alpine:3.20
RUN addgroup -g 10001 kanb && adduser -u 10001 -G kanb -D -h /app kanb
WORKDIR /app
COPY kanb-server-linux /app/kanb-server
USER kanb
EXPOSE 8400
VOLUME /data
ENTRYPOINT ["/app/kanb-server"]
CMD ["-addr", ":8400", "-db", "/data/kanb.db"]
