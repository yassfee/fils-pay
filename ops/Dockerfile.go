# Settlement daemon/CLI. Built here, never on the hosted box: the binary is
# static, so the runtime image holds nothing but the binary.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download
COPY apps/settlement/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/settlement ./cmd/settlement

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/settlement ./settlement
CMD ["./settlement", "daemon"]
