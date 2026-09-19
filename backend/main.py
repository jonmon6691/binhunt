from dotenv import load_dotenv
load_dotenv()

import base64
import hashlib
import hmac
import io
import json
import logging
import os
import secrets
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from PIL import Image
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from backend.database import (
    delete_photo as db_delete_photo,
    get_data_dir,
    get_manifest,
    get_photo,
    init_db,
)
from backend.ingestion import process_image
from backend.models import LoginRequest, LoginResponse, UploadResponse
from backend.seed import auto_seed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("spacegrep-app")

# Secret key for signing admin session tokens
SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not SECRET_KEY:
    admin_pw = os.getenv("ADMIN_PASSWORD", "spacegrep-default-password")
    SECRET_KEY = hashlib.sha256(f"spacegrep-secret:{admin_pw}".encode("utf-8")).hexdigest()

TOKEN_EXPIRE_SECONDS = 3600  # 1 hour

# Rate limiting configuration: 10 requests per IP per minute on sensitive endpoints
RATE_LIMIT_WINDOW = 60.0  # seconds
RATE_LIMIT_MAX_REQUESTS = 10
_ip_request_timestamps: dict[str, list[float]] = defaultdict(list)

# Rate limiting for failed login attempts: 5 failed attempts per IP within 5 minutes
LOGIN_RATE_LIMIT_WINDOW = 300.0  # 5 minutes
LOGIN_RATE_LIMIT_MAX_FAILURES = 5
_failed_login_attempts: dict[str, list[float]] = defaultdict(list)

# Upload limits
MAX_UPLOAD_SIZE = 25 * 1024 * 1024  # 25 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB chunks


def check_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    timestamps = _ip_request_timestamps[client_ip]
    # Prune timestamps older than window
    _ip_request_timestamps[client_ip] = [t for t in timestamps if now - t < RATE_LIMIT_WINDOW]
    if len(_ip_request_timestamps[client_ip]) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Maximum 10 requests per minute.",
        )
    _ip_request_timestamps[client_ip].append(now)


def check_login_rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    attempts = _failed_login_attempts[client_ip]
    _failed_login_attempts[client_ip] = [t for t in attempts if now - t < LOGIN_RATE_LIMIT_WINDOW]
    if len(_failed_login_attempts[client_ip]) >= LOGIN_RATE_LIMIT_MAX_FAILURES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again after 5 minutes.",
        )


def record_failed_login(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    _failed_login_attempts[client_ip].append(time.time())


def clear_failed_logins(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    _failed_login_attempts.pop(client_ip, None)


def generate_admin_token(expires_in: int = TOKEN_EXPIRE_SECONDS) -> str:
    """Generates a stateless HMAC-SHA256 signed Bearer token."""
    now = time.time()
    payload = {
        "role": "admin",
        "iat": int(now),
        "exp": int(now + expires_in),
        "jti": secrets.token_hex(16),
    }
    payload_json = json.dumps(payload, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode("utf-8")).decode("utf-8").rstrip("=")
    sig = hmac.new(SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")
    return f"{payload_b64}.{sig_b64}"


http_bearer = HTTPBearer(auto_error=False)


def verify_admin_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer),
) -> dict:
    """Verifies that the client provided a valid, unexpired HMAC-signed Bearer token."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header. Bearer token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials.strip()
    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token format",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload_b64, sig_b64 = parts
    # Verify HMAC signature
    expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode("utf-8").rstrip("=")

    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token signature",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Decode and inspect payload
    try:
        padding = 4 - (len(payload_b64) % 4)
        if padding != 4:
            payload_b64_padded = payload_b64 + ("=" * padding)
        else:
            payload_b64_padded = payload_b64
        payload_bytes = base64.urlsafe_b64decode(payload_b64_padded)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Corrupt token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check expiration
    exp = payload.get("exp", 0)
    if time.time() > exp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )

    admin_password = os.getenv("ADMIN_PASSWORD", "").strip()
    if not admin_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin operations are disabled: ADMIN_PASSWORD is not set or is blank in .env",
        )

    return payload


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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# Allowed origins configuration
default_origins = [
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5173",
]
env_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
domain_name = os.getenv("DOMAIN_NAME", "").strip()
if domain_name:
    default_origins.append(f"https://{domain_name}")
    default_origins.append(f"http://{domain_name}")

allowed_origins = list(dict.fromkeys(default_origins + env_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "spacegrep-app"}


@app.get("/api/manifest")
def get_inventory_manifest():
    """Returns complete shelf photos and bin annotations for client search."""
    return get_manifest()


@app.get("/api/config")
def get_config():
    """Returns client configuration such as optional whitebox logo URL and link URL."""
    return {
        "whitebox_logo_url": os.getenv("WHITEBOX_LOGO_URL", "") or os.getenv("VITE_WHITEBOX_LOGO_URL", ""),
        "whitebox_link_url": os.getenv("WHITEBOX_LINK_URL", "") or os.getenv("VITE_WHITEBOX_LINK_URL", ""),
    }


@app.post(
    "/api/auth/login",
    response_model=LoginResponse,
    dependencies=[Depends(check_login_rate_limit)],
)
def login(request: Request, body: LoginRequest):
    """Authenticates admin password and issues a signed Bearer token."""
    admin_password = os.getenv("ADMIN_PASSWORD", "").strip()
    if not admin_password:
        record_failed_login(request)
        logger.warning(
            "Admin login rejected: ADMIN_PASSWORD is not set or is blank in environment/.env"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin login is disabled: ADMIN_PASSWORD is not set or is blank in .env",
        )

    # Reject if submitted password is empty/whitespace or does not match
    submitted = body.password.strip() if body.password else ""
    if not submitted or not hmac.compare_digest(body.password, admin_password):
        record_failed_login(request)
        logger.warning(
            "Failed admin login attempt from IP %s",
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin password",
        )

    clear_failed_logins(request)
    token = generate_admin_token(expires_in=TOKEN_EXPIRE_SECONDS)
    return LoginResponse(
        token=token,
        token_type="bearer",
        expires_in=TOKEN_EXPIRE_SECONDS,
    )


@app.post(
    "/api/photos",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_rate_limit), Depends(verify_admin_token)],
)
async def upload_photo(
    file: UploadFile = File(...),
):
    """Ingests a new shelf photo, running Gemini VLM detection."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image (jpeg, png, webp)",
        )

    contents = bytearray()
    while chunk := await file.read(CHUNK_SIZE):
        contents.extend(chunk)
        if len(contents) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="File size exceeds maximum allowed limit (25MB)",
            )

    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    # Validate image header and integrity with Pillow
    try:
        with Image.open(io.BytesIO(contents)) as test_img:
            test_img.verify()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or corrupt image file",
        )

    try:
        record = process_image(
            file_bytes=bytes(contents),
            original_name=file.filename or "uploaded_shelf.jpg",
        )
        return {"status": "created", "photo": record}
    except ValueError as ve:
        logger.warning("Validation error in photo upload: %s", ve)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        logger.exception("Failed to process photo upload: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process photo due to an internal server error",
        )


@app.delete(
    "/api/photos/{photo_id}",
    dependencies=[Depends(check_rate_limit), Depends(verify_admin_token)],
)
def delete_photo_endpoint(
    photo_id: str,
):
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
    orig_img = images_dir / f"orig_{photo['filename']}"
    thumb_img = images_dir / f"thumb_{photo['filename']}"
    if main_img.exists():
        main_img.unlink(missing_ok=True)
    if orig_img.exists():
        orig_img.unlink(missing_ok=True)
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


def safe_file_response(base_dir: Path, relative_path: str) -> Response:
    """Safely serves static files preventing directory traversal outside base_dir."""
    base_resolved = base_dir.resolve()
    target = (base_dir / relative_path).resolve()

    if not target.is_relative_to(base_resolved):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )

    if target.exists() and target.is_file():
        return FileResponse(target)

    index_file = base_dir / "index.html"
    if index_file.exists() and index_file.is_file():
        return FileResponse(index_file)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Not found",
    )


# Serve built frontend static assets if present
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
static_dir = Path("/app/static")

if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return safe_file_response(frontend_dist, full_path)

elif static_dir.exists() and (static_dir / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa_docker(full_path: str):
        return safe_file_response(static_dir, full_path)

