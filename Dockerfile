# ==========================================
# Stage 1: Build Frontend SPA
# ==========================================
FROM node:20-slim AS frontend-builder
WORKDIR /build

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Production Python Appliance
# ==========================================
FROM python:3.11-slim AS runtime
WORKDIR /app

# Install system dependencies (curl for healthchecks, libgl1 for OpenCV/Pillow if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Pre-cache the FastEmbed model in the Docker image so it starts up instantly offline
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

# Copy built frontend assets into static and frontend/dist
COPY --from=frontend-builder /build/dist /app/frontend/dist
COPY --from=frontend-builder /build/dist /app/static

# Copy backend application code
COPY backend/ /app/backend/

# Create default data directories
RUN mkdir -p /app/data/images /app/data/seed_photos

ENV DATA_DIR=/app/data
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
