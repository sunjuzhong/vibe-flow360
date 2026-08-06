.PHONY: dev web server build init test clean cad-runtime install tutorials-registry tutorials-coverage tutorials-validate tutorials-test

web:
	cd web && npm run build
	rm -rf internal/server/dist
	cp -R web/dist internal/server/dist

server: web
	go run ./cmd/server serve

dev: web
	go run ./cmd/server serve

build: web
	go build -buildvcs=false -o vibe-flow360 ./cmd/server

init: build
	./vibe-flow360 init

cad-runtime:
	uv run --no-project --python 3.11 --with cadquery==2.6.1 python -c 'import cadquery; print("CadQuery runtime ready:", cadquery.__version__)'

install: build
	install -d /Users/juzhongsun/.local/bin
	install -m 755 vibe-flow360 /Users/juzhongsun/.local/bin/vibe-flow360

test: web
	go test ./...
	cd web && npm run test

tutorials-registry:
	python3 scripts/export_flow360_features.py

tutorials-coverage:
	go run ./cmd/tutorial-coverage

tutorials-validate:
	python3 scripts/validate_tutorials.py
	go run ./cmd/tutorial-coverage --validation-report .tutorial-validation/report.json

tutorials-test:
	python3 -m unittest scripts/test_validate_tutorials.py
	go test ./cmd/tutorial-coverage
	python3 tutorials/T01-first-lift-drag/build_simulation.py --check
	python3 tutorials/T02-project-entry-paths/build_simulation.py --check
	python3 tutorials/T03-cylinder-boundary-layer/build_simulation.py --check
	$(MAKE) tutorials-validate

clean:
	rm -rf web/dist internal/server/dist vibe-flow360 vibesim
