.PHONY: dev web server serve build init test clean cad-runtime install tutorials-registry tutorials-coverage tutorials-validate tutorials-test

SERVE_ADDR ?= :9292
SERVE_ENV_FILE ?= $(CURDIR)/.env

web:
	cd web && npm run build
	rm -rf internal/server/dist
	cp -R web/dist internal/server/dist

server: web
	go run ./cmd/server serve

serve: build
	sh ./scripts/restart-serve.sh "$(CURDIR)/vibe-flow360" "$(SERVE_ENV_FILE)" "$(SERVE_ADDR)"

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
	python3 tutorials/T02-wind-tunnel-similarity/build_simulation.py --check
	python3 tutorials/T03-cylinder-boundary-layer/build_simulation.py --check
	python3 tutorials/T04-airfoil-edge-refinement/build_simulation.py --check
	python3 tutorials/T05-wake-volume-refinement/build_simulation.py --check
	python3 tutorials/T06-farfield-selection/build_simulation.py --check
	python3 tutorials/T07-internal-flow-meshing/build_simulation.py --check
	python3 tutorials/T08-automotive-wind-tunnel/build_simulation.py --check
	python3 tutorials/T09-nested-rotation/build_simulation.py --check
	python3 tutorials/T10-snappy-surface-meshing/build_simulation.py --check
	$(MAKE) tutorials-validate

clean:
	rm -rf web/dist internal/server/dist vibe-flow360 vibesim
