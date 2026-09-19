from dotenv import load_dotenv
load_dotenv()

import json
import logging
import os
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image, ImageOps

from backend.database import (
    get_data_dir,
    insert_bin,
    insert_photo,
)
from backend.models import GeminiDetectedBin

logger = logging.getLogger(__name__)

# Lazy singleton for fastembed model
_EMBEDDING_MODEL = None


def get_embedding_model():
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        try:
            from fastembed import TextEmbedding
            # BAAI/bge-small-en-v1.5 produces 384-dimensional normalized vectors
            _EMBEDDING_MODEL = TextEmbedding("BAAI/bge-small-en-v1.5")
        except Exception as e:
            logger.warning("Could not initialize FastEmbed TextEmbedding: %s", e)
            _EMBEDDING_MODEL = None
    return _EMBEDDING_MODEL


def compute_dense_embedding(text: str) -> List[float]:
    """Generates a 384-dimensional float vector for the input text."""
    model = get_embedding_model()
    if model is not None:
        try:
            vectors = list(model.embed([text]))
            if len(vectors) > 0:
                return [float(x) for x in vectors[0]]
        except Exception as e:
            logger.warning("Embedding generation failed: %s", e)

    # Deterministic fallback vector (384 floats) if FastEmbed is unavailable
    import hashlib
    h = hashlib.sha256(text.encode("utf-8")).digest()
    repeated = (h * 48)[: 384 * 4]
    import struct
    floats = struct.unpack(f"{384}f", repeated)
    norm = sum(f * f for f in floats) ** 0.5 or 1.0
    return [float(f / norm) for f in floats]


def normalize_box(box_2d: List[int]) -> List[float]:
    """
    Converts [ymin, xmin, ymax, xmax] (0 to 1000 scale)
    to [x, y, w, h] (0.0 to 1.0 scale).
    """
    ymin, xmin, ymax, xmax = box_2d
    x = max(0.0, min(1.0, xmin / 1000.0))
    y = max(0.0, min(1.0, ymin / 1000.0))
    w = max(0.0, min(1.0 - x, (xmax - xmin) / 1000.0))
    h = max(0.0, min(1.0 - y, (ymax - ymin) / 1000.0))
    return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)]


def detect_bins_with_gemini(
    image_bytes: bytes,
    api_key: str,
    model_name: Optional[str] = None,
) -> List[GeminiDetectedBin]:
    """Calls the Google Gemini API to identify workshop storage bins with structured JSON output."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    prompt = (
        "You are an inventory detection system for an electronics workshop / hackerspace.\n"
        "Carefully examine this shelf or organizer photo. Identify every storage bin, box, drawer, container, "
        "and tub that has visible labels, part numbers, or identifiable tools/components.\n"
        "For each detected item, provide:\n"
        "1. box_2d: normalized coordinates [ymin, xmin, ymax, xmax] scaled 0 to 1000 tightly bounding the bin, drawer, or container\n"
        "2. label: exact transcribed text from the bin's label or visible component name\n"
        "3. semantic_tags: 3 to 5 functional keywords, synonyms, component types, or common use-cases "
        "(e.g., for 'CR2032', include ['coin cell', '3V battery', 'CMOS battery', 'button cell'])\n"
        "Return a JSON array of detected bins."
    )

    contents = [
        types.Part.from_bytes(
            data=image_bytes,
            mime_type="image/jpeg",
        ),
        prompt,
    ]

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=list[GeminiDetectedBin],
        temperature=0.1,
    )

    candidate_models = [
        model_name or os.getenv("GEMINI_MODEL", "gemini-3.6-flash"),
        "gemini-3.6-flash",
        "gemini-3.8-flash",
        "gemini-flash-latest",
    ]
    # Deduplicate while preserving order
    seen = set()
    models_to_try = [m for m in candidate_models if m and not (m in seen or seen.add(m))]

    last_error = None
    for model in models_to_try:
        try:
            logger.info("Attempting Gemini VLM detection with model: %s", model)
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            if response.text:
                raw_items = json.loads(response.text)
                detected = [GeminiDetectedBin(**item) for item in raw_items]
                logger.info("Successfully detected %d bins with %s", len(detected), model)
                return detected
        except Exception as e:
            logger.warning("Gemini model %s failed: %s", model, e)
            last_error = e

    raise RuntimeError(f"All candidate Gemini models failed. Last error: {last_error}")


def mock_detect_bins(width: int, height: int, filename: str = "") -> List[GeminiDetectedBin]:
    """
    Fallback mock detector when GEMINI_API_KEY is not configured.
    Generates a realistic grid of workshop storage bins for offline development and testing.
    """
    sample_components = [
        {
            "label": "Kapton Tape & PVC Electrical Tape",
            "tags": ["insulation", "heat resistant tape", "wiring", "soldering mask"],
            "box": [120, 80, 260, 280],
        },
        {
            "label": "CR2032 3V Coin Cell Batteries",
            "tags": ["coin cell", "3V battery", "CMOS battery", "button cell", "power"],
            "box": [120, 320, 260, 520],
        },
        {
            "label": "ESP32 & ESP8266 Dev Boards",
            "tags": ["microcontroller", "wifi", "bluetooth", "iot", "arduino"],
            "box": [120, 560, 260, 760],
        },
        {
            "label": "Digital Multimeters & Test Leads",
            "tags": ["voltmeter", "measure voltage", "resistance", "continuity", "dmm"],
            "box": [340, 80, 520, 340],
        },
        {
            "label": "N-Channel MOSFETs (IRFZ44N / 2N7000)",
            "tags": ["transistor", "switching", "power mosfet", "gate drive", "semiconductor"],
            "box": [340, 380, 520, 620],
        },
        {
            "label": "Weller Soldering Tips & Brass Sponges",
            "tags": ["soldering iron", "tip cleaner", "flux", "solder station", "wlc100"],
            "box": [340, 660, 520, 920],
        },
        {
            "label": "Heat Shrink Tubing Assortment",
            "tags": ["wire insulation", "heat gun", "polyolefin", "cable sleeve"],
            "box": [600, 80, 780, 320],
        },
        {
            "label": "Anti-Static ESD Wrist Straps",
            "tags": ["fix static shock", "grounding", "esd wristband", "static protection"],
            "box": [600, 360, 780, 600],
        },
        {
            "label": "0.1uF / 10uF Ceramic & Electrolytic Caps",
            "tags": ["capacitors", "decoupling", "filtering", "power rail", "farads"],
            "box": [600, 640, 780, 900],
        },
    ]

    return [
        GeminiDetectedBin(
            box_2d=c["box"],
            label=c["label"],
            semantic_tags=c["tags"],
        )
        for c in sample_components
    ]


def process_image(
    file_bytes: bytes,
    original_name: str,
    gemini_api_key: Optional[str] = None,
    gemini_model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Complete ingestion pipeline:
    1. Preprocesses image (EXIF orientation, storage, thumbnail).
    2. Runs bin detection via Gemini API or mock fallback.
    3. Normalizes bounding boxes and computes FastEmbed dense vectors.
    4. Commits records to SQLite database.
    """
    data_dir = get_data_dir()
    images_dir = data_dir / "images"

    # 1. Image preprocessing via Pillow
    image = Image.open(BytesIO(file_bytes))
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")

    orig_width, orig_height = image.size
    photo_id = str(uuid.uuid4())
    filename = f"{photo_id}.jpg"
    thumb_filename = f"thumb_{photo_id}.jpg"

    full_path = images_dir / filename
    thumb_path = images_dir / thumb_filename

    # Save full resolution JPEG
    image.save(full_path, "JPEG", quality=92, optimize=True)

    # Save web-optimized thumbnail (max 400px width)
    thumb_width = 400
    thumb_height = int(orig_height * (thumb_width / orig_width))
    thumb_image = image.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
    thumb_image.save(thumb_path, "JPEG", quality=85)

    # Insert photo into database
    photo_record = insert_photo(
        photo_id=photo_id,
        filename=filename,
        original_name=original_name,
        width=orig_width,
        height=orig_height,
    )

    # 2. Vision detection
    api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
    detected_bins: List[GeminiDetectedBin] = []

    if api_key and api_key.strip():
        logger.info("Calling Gemini API for photo %s...", original_name)
        # Re-encode compressed jpeg for the API call (max 2048px to stay fast and within limits)
        api_img = image
        if max(orig_width, orig_height) > 2048:
            scale = 2048 / max(orig_width, orig_height)
            api_img = image.resize(
                (int(orig_width * scale), int(orig_height * scale)),
                Image.Resampling.LANCZOS,
            )
        api_buf = BytesIO()
        api_img.save(api_buf, "JPEG", quality=85)
        try:
            detected_bins = detect_bins_with_gemini(
                image_bytes=api_buf.getvalue(),
                api_key=api_key,
                model_name=gemini_model,
            )
        except Exception as e:
            logger.error("Gemini detection error: %s", e)
            if os.getenv("ALLOW_MOCK_FALLBACK", "").lower() in ("true", "1"):
                logger.warning("Falling back to mock detection because ALLOW_MOCK_FALLBACK is enabled.")
                detected_bins = mock_detect_bins(orig_width, orig_height, original_name)
            else:
                raise
    else:
        logger.info("GEMINI_API_KEY not provided. Using offline mock detector for %s.", original_name)
        detected_bins = mock_detect_bins(orig_width, orig_height, original_name)

    # 3. Coordinate normalization and embedding generation
    for b in detected_bins:
        bin_id = str(uuid.uuid4())
        norm_bbox = normalize_box(b.box_2d)
        embed_text = f"{b.label} | {' '.join(b.semantic_tags)}"
        vector = compute_dense_embedding(embed_text)

        insert_bin(
            bin_id=bin_id,
            photo_id=photo_id,
            label=b.label,
            semantic_tags=b.semantic_tags,
            bbox=norm_bbox,
            embedding=vector,
        )

    from backend.database import get_photo
    return get_photo(photo_id) or photo_record
