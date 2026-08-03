.PHONY: dev web server build test clean cad-runtime install

web:
	cd web && npm run build
	rm -rf internal/server/dist
	cp -R web/dist internal/server/dist

server: web
	go run ./cmd/server

dev: web
	go run ./cmd/server

build: web
	go build -buildvcs=false -o vibe-flow360 ./cmd/server

cad-runtime:
	uv run --no-project --with cadquery==2.6.1 python -c 'import cadquery; print("CadQuery runtime ready:", cadquery.__version__)'

install: build cad-runtime
	install -d /Users/juzhongsun/.local/bin
	install -m 755 vibe-flow360 /Users/juzhongsun/.local/bin/vibe-flow360

test: web
	go test ./...
	cd web && npm run test

clean:
	rm -rf web/dist internal/server/dist vibe-flow360 vibesim
