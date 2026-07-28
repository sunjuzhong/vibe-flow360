.PHONY: dev web server build test clean

web:
	cd web && npm run build
	rm -rf internal/server/dist
	cp -R web/dist internal/server/dist

server:
	go run ./cmd/server

dev:
	go run ./cmd/server

build: web
	go build -buildvcs=false -o vibesim ./cmd/server

test:
	go test ./...
	cd web && npm run test

clean:
	rm -rf web/dist internal/server/dist vibesim
