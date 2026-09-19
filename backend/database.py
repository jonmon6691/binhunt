import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional


def get_data_dir() -> Path:
    data_dir = os.getenv("DATA_DIR", "./data")
    path = Path(data_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / "images").mkdir(parents=True, exist_ok=True)
    (path / "seed_photos").mkdir(parents=True, exist_ok=True)
    return path


def get_db_path() -> Path:
    return get_data_dir() / "inventory.db"


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db():
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS photos (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS bins (
                    id TEXT PRIMARY KEY,
                    photo_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    semantic_tags TEXT NOT NULL,
                    bbox_x REAL NOT NULL,
                    bbox_y REAL NOT NULL,
                    bbox_w REAL NOT NULL,
                    bbox_h REAL NOT NULL,
                    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
                );
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_bins_photo_id ON bins(photo_id);
                """
            )
    finally:
        conn.close()


def insert_photo(
    photo_id: str,
    filename: str,
    original_name: str,
    width: int,
    height: int,
) -> Dict[str, Any]:
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO photos (id, filename, original_name, width, height)
                VALUES (?, ?, ?, ?, ?)
                """,
                (photo_id, filename, original_name, width, height),
            )
        return get_photo(photo_id)
    finally:
        conn.close()


def insert_bin(
    bin_id: str,
    photo_id: str,
    label: str,
    semantic_tags: List[str],
    bbox: List[float],
):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO bins (
                    id, photo_id, label, semantic_tags,
                    bbox_x, bbox_y, bbox_w, bbox_h
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    bin_id,
                    photo_id,
                    label,
                    json.dumps(semantic_tags),
                    bbox[0],
                    bbox[1],
                    bbox[2],
                    bbox[3],
                ),
            )
    finally:
        conn.close()


def get_photo(photo_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT id, filename, original_name, width, height, created_at FROM photos WHERE id = ?",
            (photo_id,),
        ).fetchone()
        if not row:
            return None
        photo_dict = dict(row)
        bin_rows = conn.execute(
            """
            SELECT id, photo_id, label, semantic_tags, bbox_x, bbox_y, bbox_w, bbox_h
            FROM bins WHERE photo_id = ?
            """,
            (photo_id,),
        ).fetchall()
        bins = []
        for b in bin_rows:
            bins.append(
                {
                    "id": b["id"],
                    "photo_id": b["photo_id"],
                    "label": b["label"],
                    "semantic_tags": json.loads(b["semantic_tags"]),
                    "bbox": [b["bbox_x"], b["bbox_y"], b["bbox_w"], b["bbox_h"]],
                }
            )
        photo_dict["bins"] = bins
        return photo_dict
    finally:
        conn.close()


def get_photo_by_original_name(original_name: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT id FROM photos WHERE original_name = ?",
            (original_name,),
        ).fetchone()
        if not row:
            return None
        return get_photo(row["id"])
    finally:
        conn.close()


def get_manifest() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        photos = conn.execute(
            "SELECT id, filename, original_name, width, height, created_at FROM photos ORDER BY created_at ASC"
        ).fetchall()
        results = []
        for p in photos:
            photo_dict = dict(p)
            bin_rows = conn.execute(
                """
                SELECT id, photo_id, label, semantic_tags, bbox_x, bbox_y, bbox_w, bbox_h
                FROM bins WHERE photo_id = ?
                """,
                (p["id"],),
            ).fetchall()
            photo_dict["bins"] = [
                {
                    "id": b["id"],
                    "photo_id": b["photo_id"],
                    "label": b["label"],
                    "semantic_tags": json.loads(b["semantic_tags"]),
                    "bbox": [b["bbox_x"], b["bbox_y"], b["bbox_w"], b["bbox_h"]],
                }
                for b in bin_rows
            ]
            results.append(photo_dict)
        return results
    finally:
        conn.close()


def delete_photo(photo_id: str) -> bool:
    conn = get_db_connection()
    try:
        with conn:
            cursor = conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
            return cursor.rowcount > 0
    finally:
        conn.close()
