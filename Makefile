.PHONY: all install test build run dev seed docker-build docker-up docker-down clean

all: install build test

install:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	cd frontend && npm install

test:
	.venv/bin/python -m pytest tests/ -v

build:
	cd frontend && npm run build

seed:
	.venv/bin/python -m backend.seed

run: build
	DATA_DIR=./data .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

dev:
	@echo "Starting backend and frontend in parallel..."
	(DATA_DIR=./data .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload & cd frontend && npm run dev)

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

clean:
	@echo "Stopping any running backend server processes..."
	-pkill -f "uvicorn backend.main:app" || true
	@echo "Removing database and processed images..."
	rm -f data/inventory.db data/inventory.db-wal data/inventory.db-shm
	rm -rf data/images/*
	mkdir -p data/images data/seed_photos
	@echo "Reinitializing database..."
	.venv/bin/python -c "from backend.database import init_db; init_db()"
	@echo "Clean and reinitialization complete."

