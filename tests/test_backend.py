import os
import shutil
import tempfile
from pathlib import Path

import pytest
from PIL import Image
from fastapi.testclient import TestClient

# Use temporary data directory for tests
test_dir = tempfile.mkdtemp()
os.environ["DATA_DIR"] = test_dir

from backend.database import (
    get_data_dir,
    get_manifest,
    get_photo,
    init_db,
    insert_bin,
    insert_photo,
)
from backend.ingestion import normalize_box, process_image
from backend.main import app
from backend.seed import auto_seed, generate_default_sample_shelf_photo


@pytest.fixture(autouse=True)
def setup_and_teardown():
    init_db()
    yield
    # clean up test dir if needed


def test_coordinate_normalization():
    box_2d = [100, 200, 500, 800]  # ymin, xmin, ymax, xmax
    norm = normalize_box(box_2d)
    # x = 200/1000 = 0.2, y = 100/1000 = 0.1, w = (800-200)/1000 = 0.6, h = (500-100)/1000 = 0.4
    assert norm == [0.2, 0.1, 0.6, 0.4]


def test_database_photo_and_bins():
    photo = insert_photo(
        photo_id="test-p1",
        filename="test-p1.jpg",
        original_name="shelf.jpg",
        width=1920,
        height=1080,
    )
    assert photo["id"] == "test-p1"

    insert_bin(
        bin_id="test-b1",
        photo_id="test-p1",
        label="CR2032 Coin Cells",
        semantic_tags=["battery", "3v"],
        bbox=[0.1, 0.2, 0.3, 0.4],
    )

    retrieved = get_photo("test-p1")
    assert retrieved is not None
    assert len(retrieved["bins"]) == 1
    assert retrieved["bins"][0]["label"] == "CR2032 Coin Cells"


def test_api_manifest_and_upload(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    client = TestClient(app)

    # Health
    r = client.get("/api/health")
    assert r.status_code == 200

    # Create dummy test image
    img = Image.new("RGB", (300, 300), color=(100, 150, 200))
    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)

    # Upload
    upload_res = client.post(
        "/api/photos",
        files={"file": ("test_upload.jpg", buf, "image/jpeg")},
    )
    assert upload_res.status_code == 201
    data = upload_res.json()
    assert "photo" in data
    photo_id = data["photo"]["id"]
    assert len(data["photo"]["bins"]) > 0

    # Manifest
    manifest_res = client.get("/api/manifest")
    assert manifest_res.status_code == 200
    manifest = manifest_res.json()
    assert any(p["id"] == photo_id for p in manifest)

    # Delete
    del_res = client.delete(f"/api/photos/{photo_id}")
    assert del_res.status_code == 200
    assert get_photo(photo_id) is None


def test_auto_seed_creates_sample_if_empty():
    count = auto_seed()
    # If the test data dir had no photos, it creates the starter sample photo
    assert count >= 0
    manifest = get_manifest()
    assert len(manifest) >= 1
    # Running auto_seed again should be idempotent (0 new ingested)
    count_second = auto_seed()
    assert count_second == 0

