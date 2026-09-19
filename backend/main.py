from dotenv import load_dotenv
load_dotenv()

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.database import (
    delete_photo as db_delete_photo,
    get_data_dir,
    get_manifest,
    get_photo,
    init_db,
)
from backend.ingestion import process_image
from backend.models import UploadResponse
from backend.seed import auto_seed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("inventory-locator")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize database and scan seed folder
    init_db()
    try:
        new_count = auto_seed()
        logger.info("Startup complete. Auto-seeded %d photos.", new_count)
    except Exception as e:
        logger.exception("Error during auto-seed: %s", e)
    yield


app = FastAPI(
    title="Hackerspace Visual Inventory Locator",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for local frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "inventory-locator"}


@app.get("/api/manifest")
def get_inventory_manifest():
    """Returns complete shelf photos and bin annotations with embeddings for client search."""
    return get_manifest()


@app.post("/api/photos", status_code=status.HTTP_201_CREATED)
async def upload_photo(file: UploadFile = File(...)):
    """Ingests a new shelf photo, running Gemini VLM detection and vector embeddings."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image (jpeg, png, webp)",
        )

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    try:
        record = process_image(
            file_bytes=contents,
            original_name=file.filename or "uploaded_shelf.jpg",
        )
        return {"status": "created", "photo": record}
    except Exception as e:
        logger.exception("Failed to process photo upload: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process photo: {str(e)}",
        )


@app.delete("/api/photos/{photo_id}")
def delete_photo_endpoint(photo_id: str):
    """Deletes a shelf photo, its thumbnail, and all associated bin annotations."""
    photo = get_photo(photo_id)
    if not photo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Photo with id {photo_id} not found",
        )

    data_dir = get_data_dir()
    images_dir = data_dir / "images"

    # Remove image files from disk
    main_img = images_dir / photo["filename"]
    thumb_img = images_dir / f"thumb_{photo['filename']}"
    if main_img.exists():
        main_img.unlink(missing_ok=True)
    if thumb_img.exists():
        thumb_img.unlink(missing_ok=True)

    success = db_delete_photo(photo_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete database record",
        )

    return {"status": "deleted", "id": photo_id}


# Mount image files
data_dir = get_data_dir()
images_path = data_dir / "images"
images_path.mkdir(parents=True, exist_ok=True)
app.mount("/images", StaticFiles(directory=str(images_path)), name="images")

# Serve built frontend static assets if present
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
static_dir = Path("/app/static")

if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        target = frontend_dist / full_path
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(frontend_dist / "index.html")
elif static_dir.exists() and (static_dir / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa_docker(full_path: str):
        target = static_dir / full_path
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(static_dir / "index.html")
