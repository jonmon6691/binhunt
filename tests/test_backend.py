import hashlib
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
from backend.ingestion import (
    calculate_iou,
    compress_image_to_target,
    generate_tiles,
    normalize_box,
    process_image,
    project_box_to_global,
    suppress_duplicate_bins,
)
from backend.models import GeminiDetectedBin
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
    monkeypatch.setenv("ADMIN_PASSWORD", "supersecret123")
    client = TestClient(app)

    # Health
    r = client.get("/api/health")
    assert r.status_code == 200

    # Create dummy test image
    img = Image.new("RGB", (300, 300), color=(100, 150, 200))
    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    img_bytes = buf.getvalue()

    # Upload without password header should fail (401)
    unauth_res = client.post(
        "/api/photos",
        files={"file": ("test_upload.jpg", io.BytesIO(img_bytes), "image/jpeg")},
    )
    assert unauth_res.status_code == 401

    # Upload with invalid password hash should fail (401)
    invalid_hash_res = client.post(
        "/api/photos",
        files={"file": ("test_upload.jpg", io.BytesIO(img_bytes), "image/jpeg")},
        headers={"X-Admin-Password-Hash": "invalidhash123"},
    )
    assert invalid_hash_res.status_code == 401

    # Upload with correct password hash should succeed (201)
    correct_hash = hashlib.sha256(b"supersecret123").hexdigest()
    upload_res = client.post(
        "/api/photos",
        files={"file": ("test_upload.jpg", io.BytesIO(img_bytes), "image/jpeg")},
        headers={"X-Admin-Password-Hash": correct_hash},
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
    images_dir = get_data_dir() / "images"
    assert (images_dir / f"{photo_id}.jpg").exists()
    assert (images_dir / f"orig_{photo_id}.jpg").exists()
    assert (images_dir / f"thumb_{photo_id}.jpg").exists()

    # Delete without password header should fail (401)
    unauth_del = client.delete(f"/api/photos/{photo_id}")
    assert unauth_del.status_code == 401

    # Delete with invalid password hash should fail (401)
    invalid_del = client.delete(
        f"/api/photos/{photo_id}",
        headers={"X-Admin-Password-Hash": "wronghash"},
    )
    assert invalid_del.status_code == 401

    # Delete with correct password hash should succeed (200)
    del_res = client.delete(
        f"/api/photos/{photo_id}",
        headers={"X-Admin-Password-Hash": correct_hash},
    )
    assert del_res.status_code == 200
    assert get_photo(photo_id) is None
    assert not (images_dir / f"{photo_id}.jpg").exists()
    assert not (images_dir / f"orig_{photo_id}.jpg").exists()
    assert not (images_dir / f"thumb_{photo_id}.jpg").exists()


def test_auto_seed_creates_sample_if_empty():
    count = auto_seed()
    # If the test data dir had no photos, it creates the starter sample photo
    assert count >= 0
    manifest = get_manifest()
    assert len(manifest) >= 1
    # Running auto_seed again should be idempotent (0 new ingested)
    count_second = auto_seed()
    assert count_second == 0


def test_generate_tiles():
    # Small image: should return exactly 1 tile
    small_img = Image.new("RGB", (800, 600))
    small_tiles = generate_tiles(small_img)
    assert len(small_tiles) == 1
    assert small_tiles[0][1] == (0, 0, 800, 600)

    # Large image: 4080x3072
    large_img = Image.new("RGB", (4080, 3072))
    large_tiles = generate_tiles(large_img, overlap_ratio=0.20)
    assert len(large_tiles) >= 4

    # Verify each tile is within bounds
    for tile_img, (left, top, right, bottom) in large_tiles:
        assert 0 <= left < right <= 4080
        assert 0 <= top < bottom <= 3072
        assert tile_img.size == (right - left, bottom - top)


def test_project_box_to_global():
    # Box in a tile: tile is (1000, 1000, 3000, 3000) on a 4000x4000 image
    tile_rect = (1000, 1000, 3000, 3000)
    # Box inside tile: top-left quadrant of tile: ymin=0, xmin=0, ymax=500, xmax=500
    tile_box = [0, 0, 500, 500]
    global_box = project_box_to_global(tile_box, tile_rect, orig_w=4000, orig_h=4000)
    # tile_w = 2000, tile_h = 2000
    # abs_ymin = 1000 + 0 = 1000 -> 1000/4000 * 1000 = 250
    # abs_xmin = 1000 + 0 = 1000 -> 1000/4000 * 1000 = 250
    # abs_ymax = 1000 + 1000 = 2000 -> 2000/4000 * 1000 = 500
    # abs_xmax = 1000 + 1000 = 2000 -> 2000/4000 * 1000 = 500
    assert global_box == [250, 250, 500, 500]


def test_calculate_iou_and_nms():
    box_a = [100, 100, 300, 300]
    box_b = [100, 100, 300, 300]  # Identical
    box_c = [500, 500, 700, 700]  # Disjoint
    box_d = [150, 150, 350, 350]  # Partial overlap

    assert calculate_iou(box_a, box_b) == 1.0
    assert calculate_iou(box_a, box_c) == 0.0
    assert 0.2 < calculate_iou(box_a, box_d) < 0.6

    bin1 = GeminiDetectedBin(
        box_2d=[100, 100, 300, 300],
        label="CR2032 Battery",
        semantic_tags=["battery", "coin cell"],
    )
    bin2 = GeminiDetectedBin(
        box_2d=[105, 102, 305, 302],
        label="CR2032 3V Coin Cell Battery",  # More descriptive
        semantic_tags=["3v", "cmos"],
    )
    bin_distinct = GeminiDetectedBin(
        box_2d=[600, 600, 800, 800],
        label="ESP32 Board",
        semantic_tags=["microcontroller"],
    )

    merged = suppress_duplicate_bins([bin1, bin2, bin_distinct], iou_threshold=0.40)
    assert len(merged) == 2
    # Check that the more descriptive label was kept
    labels = [b.label for b in merged]
    assert "CR2032 3V Coin Cell Battery" in labels
    assert "ESP32 Board" in labels
    # Check combined tags
    battery_bin = next(b for b in merged if "CR2032" in b.label)
    assert set(battery_bin.semantic_tags) >= {"battery", "coin cell", "3v", "cmos"}


def test_compress_image_to_target():
    # Large test image: 3000x2000 with pattern
    img = Image.new("RGB", (3000, 2000), color=(120, 140, 180))
    data = compress_image_to_target(img, target_bytes=500 * 1024, max_dim=2048)
    # File size must be under 520kB
    assert len(data) <= 520 * 1024
    # Valid JPEG
    import io
    loaded = Image.open(io.BytesIO(data))
    assert max(loaded.size) <= 2048


