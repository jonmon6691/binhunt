# Hackerspace Visual Inventory Locator — Implementation Plan

**Target Audience:** Subagent / Autonomous Developer  
**Project Category:** On-premises visual inventory search appliance  
**Target Environment:** Local Docker host (e.g., Intel NUC, Raspberry Pi 5, or repurposed desktop) on a hackerspace LAN with zero cloud dependency during runtime search.

---

## 1. System Overview & Core Objectives

Build a lightweight, self-contained web appliance that displays high-resolution photos of hackerspace component shelves (bins, organizers, drawers) overlaid with a real-time search interface.

### Key Requirements
1. **Interactive Highlight Overlay:** As the user types into a persistent search bar, bounding boxes around relevant storage bins highlight dynamically in real time (< 50ms latency).
2. **Hybrid Search (Literal + Semantic):**
   * **Literal:** Instant exact/fuzzy matches on part numbers, exact labels, and component codes (e.g., `CR2032`, `WLC100`, `ESP8266`, `Kapton`, `MOSFET`).
   * **Semantic:** Finds bins based on functional intent or colloquial concepts (e.g., searching *"measure voltage"* highlights *"Multimeters"*; searching *"fix static shock"* highlights *"ESD Wristbands"*).
3. **Photo Management:** Single global state. Any member can upload a new shelf photo or delete an obsolete photo. Ingestion automatically detects bins, reads labels, infers semantic keywords, and calculates vector embeddings.
4. **Appliance-Grade Deployment:** Single Docker container, single host directory mount (`./data`), persistent SQLite database, LAN discovery via mDNS (`http://inventory.local`).

---

## 2. Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER (Kiosk/LAN)                      │
│                                                                        │
│  ┌────────────────┐     ┌───────────────────────────────────────────┐  │
│  │  Search Input  │────▶│ Web Worker: Fuse.js + Cosine Sim / TF.js │  │
│  └────────────────┘     └───────────────────────────────────────────┘  │
│           │                                   │                        │
│           ▼                                   ▼                        │
│  ┌────────────────┐               ┌───────────────────────┐            │
│  │ UI State (Tabs)│               │ SVG Highlight Overlay │            │
│  └────────────────┘               └───────────────────────┘            │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Manifest Sync (on load/upload)
┌───────────────────────────────────┴────────────────────────────────────┐
│                    BACKEND CONTAINER (FastAPI / Python)                │
│                                                                        │
│  ┌──────────────┐     ┌───────────────┐     ┌────────────────────────┐ │
│  │ Static Files │     │ REST Endpoints│     │ Ingestion Engine       │ │
│  │ (SPA Assets) │     │ (/api/photos) │     │ (VLM / OCR + FastEmbed)│ │
│  └──────────────┘     └───────┬───────┘     └───────────┬────────────┘ │
│                               │                         │              │
│                               ▼                         ▼              │
│              ┌────────────────────────────────────────────────┐        │
│              │ SQLite Database (`/app/data/inventory.db`)     │        │
│              │ Image Storage  (`/app/data/images/`)           │        │
│              └────────────────────────────────────────────────┘        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

* **Backend:** Python 3.11+, FastAPI, Uvicorn, Pillow (image manipulation).
* **Database:** SQLite 3 (stored at `/app/data/inventory.db`).
* **Embeddings & Ingestion:**
  * **Option A (Default - Cloud VLM):** Google Gemini 1.5 Flash API for one-shot OCR, bounding-box detection, and semantic keyword generation per upload.
  * **Option B (Fully Offline Fallback):** Local PaddleOCR/Tesseract + local embedding generator.
  * **Vector Embeddings:** `fastembed` (using `BAAI/bge-small-en-v1.5` or `all-MiniLM-L6-v2`, 384 dimensions) running directly in the Python container.
* **Frontend:** Vite + React (or Vanilla Preact/TS) + Tailwind CSS + Lucide Icons.
* **Client Search:**
  * **Literal:** `fuse.js` for weighted fuzzy token matching.
  * **Semantic:** Cosine similarity computed against precomputed vector blobs loaded into client memory, or client query embedded via `@xenova/transformers` in a Web Worker.

---

## 4. Database Schema (SQLite)

Path: `/app/data/inventory.db`

```sql
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,               -- UUID v4
    filename TEXT NOT NULL,            -- e.g. "shelf_2540.jpg"
    original_name TEXT NOT NULL,       -- Original uploaded name
    width INTEGER NOT NULL,            -- Original pixel width
    height INTEGER NOT NULL,           -- Original pixel height
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bins (
    id TEXT PRIMARY KEY,               -- UUID v4
    photo_id TEXT NOT NULL,
    label TEXT NOT NULL,               -- Transcribed label text (e.g., "Kapton Tape")
    semantic_tags TEXT NOT NULL,       -- JSON array of strings: '["insulation", "high temp"]'
    -- Bounding box normalized to 0.0 - 1.0 (relative to image dimensions)
    bbox_x REAL NOT NULL,              -- Top-left X
    bbox_y REAL NOT NULL,              -- Top-left Y
    bbox_w REAL NOT NULL,              -- Width
    bbox_h REAL NOT NULL,              -- Height
    embedding BLOB NOT NULL,           -- Float32 array serialized as binary (384 * 4 bytes)
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bins_photo_id ON bins(photo_id);
```

---

## 5. Ingestion Pipeline Specification

When a user submits `POST /api/photos` with an image file:

### Step 5.1: Image Preprocessing
1. Read uploaded image using Pillow.
2. Auto-rotate based on EXIF orientation.
3. Save full resolution version to `/app/data/images/{photo_id}.jpg`.
4. Generate a web-optimized medium version (max 2048px width) and a thumbnail (400px width) at `/app/data/images/thumb_{photo_id}.jpg`.
5. Insert record into `photos` table.

### Step 5.2: Bounding Box Detection & Label Transcription
Send the resized image to the Vision Language Model (Gemini 1.5 Flash or equivalent local endpoint) with structured JSON output enforcement:

```json
{
  "system_instruction": "You are an inventory detection system for an electronics workshop. Identify all storage bins, boxes, shelves, and containers with visible labels or identifiable contents. Return their normalized coordinates [ymin, xmin, ymax, xmax] scaled 0 to 1000, their transcribed label, and 3-5 functional semantic keywords or synonyms describing what components are stored inside.",
  "response_mime_type": "application/json"
}
```

**Expected JSON Response Format:**
```json
[
  {
    "box_2d": [405, 368, 447, 433],
    "label": "Kapton Tape & PVC Electrical Tape",
    "semantic_tags": ["insulation", "heat resistant tape", "wiring", "soldering mask"]
  },
  {
    "box_2d": [198, 547, 248, 614],
    "label": "CR2032 Batteries & Holders",
    "semantic_tags": ["coin cell", "3V battery", "CMOS battery", "button cell"]
  }
]
```

### Step 5.3: Coordinate Normalization
Convert `[ymin, xmin, ymax, xmax]` (0–1000 scale) to normalized float box properties `[x, y, w, h]` (0.0 to 1.0 scale):
$$x = \frac{\text{xmin}}{1000}, \quad y = \frac{\text{ymin}}{1000}$$
$$w = \frac{\text{xmax} - \text{xmin}}{1000}, \quad h = \frac{\text{ymax} - \text{ymin}}{1000}$$

### Step 5.4: Embedding Generation
For each detected bin:
1. Construct the embedding text: `f"{label} | {' '.join(semantic_tags)}"`.
2. Generate dense vector with `fastembed` (`all-MiniLM-L6-v2` or `bge-small-en-v1.5`).
3. Serialize numpy float32 array to binary bytes (`vector.tobytes()`).
4. Store in the `bins` table.

---

## 6. Backend API Specification (FastAPI)

### `GET /api/manifest`
Returns complete database state needed for client-side search.
* **Response:**
```json
[
  {
    "id": "photo_uuid_1",
    "filename": "photo_uuid_1.jpg",
    "width": 4032,
    "height": 3024,
    "bins": [
      {
        "id": "bin_uuid_1",
        "label": "Kapton Tape & PVC Electrical Tape",
        "semantic_tags": ["insulation", "heat resistant tape", "wiring"],
        "bbox": [0.368, 0.405, 0.065, 0.042],
        "embedding": [0.012, -0.045, "... 384 floats ..."]
      }
    ]
  }
]
```

### `POST /api/photos`
* **Payload:** `multipart/form-data` with `file: UploadFile`.
* **Action:** Executes Pipeline (Section 5), saves files to disk, writes to SQLite.
* **Response:** Status 201 with newly created photo and detected bins.

### `DELETE /api/photos/{photo_id}`
* **Action:** Deletes image files from `/app/data/images/` and deletes DB record (cascading deletes bins).
* **Response:** `{"status": "deleted", "id": photo_id}`

### `GET /api/search` (Fallback Backend Search)
* **Query Params:** `?q=soldering+iron&limit=10`
* **Usage:** For low-power kiosk clients unable to compute client-side embeddings. Returns sorted list of `{photo_id, bin_id, score}`.

---

## 7. Frontend Real-Time Search & UI Specification

### 7.1 Component Layout
```
+--------------------------------------------------------------------------+
|  [HACKERSPACE INVENTORY]             [Upload Photo +]  [Full Screen ⛶]   |
+--------------------------------------------------------------------------+
|                                                                          |
|         +------------------------------------------------------+         |
|         | 🔍 Search parts, tools, components (e.g. "heat tape") |         |
|         +------------------------------------------------------+         |
|                                                                          |
|  +--------------------------------------------------------------------+  |
|  | Photo Display Canvas Container                                     |  |
|  |                                                                    |  |
|  |   [Image Element: shelf_01.jpg]                                    |  |
|  |   <svg class="overlay">                                            |  |
|  |      <rect class="highlight pulsing" x="36%" y="40%" ... />        |  |
|  |      <text>Kapton Tape (98%)</text>                                |  |
|  |   </svg>                                                           |  |
|  +--------------------------------------------------------------------+  |
|                                                                          |
|  [Shelf A (12 matches)]   [Shelf B (0)]   [Shelf C (1 match)]            |
+--------------------------------------------------------------------------+
```

### 7.2 Search Matching Engine (Web Worker)
To avoid blocking the UI thread during rapid keystrokes, run the search in a Web Worker:

1. **Pre-load:** On app initialization, fetch `/api/manifest`. Initialize:
   * A `Fuse` instance indexing `label` and `semantic_tags`.
   * A flat Float32Array cache of all bin embeddings.
   * Load `@xenova/transformers` feature extraction pipeline (`Xenova/all-MiniLM-L6-v2`) via WebAssembly.
2. **On Keystroke:**
   * **Literal Scoring:** Run `fuse.search(query)` $\rightarrow \text{Score}_{\text{literal}} \in [0.0, 1.0]$.
   * **Semantic Scoring:** Run model on `query` to generate a 384-dim normalized query vector. Compute dot product against all bin embeddings $\rightarrow \text{Score}_{\text{semantic}} \in [-1.0, 1.0]$.
   * **Combined Score:**
     $$\text{FinalScore} = \max(\text{Score}_{\text{literal}} \times 1.25, \; \text{Score}_{\text{semantic}})$$
3. **Filtering:**
   * If $\text{FinalScore} \ge 0.70$: High confidence match (pulsing cyan/neon green).
   * If $0.50 \le \text{FinalScore} < 0.70$: Moderate match (amber border).
   * If $\text{FinalScore} < 0.50$: Discard / invisible.

### 7.3 SVG Overlay Layer
Use an SVG element directly stacked on top of the `<img>` tag inside a relative container:

```html
<div class="relative inline-block w-full max-w-6xl overflow-hidden rounded-lg">
  <img src="/images/{activePhoto.filename}" class="w-full h-auto block select-none" />
  <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none">
    <!-- Rendered matching rects -->
    <g class="match-box transition-all duration-150">
      <rect x="368" y="405" width="65" height="42" rx="6"
            class="fill-cyan-500/20 stroke-cyan-400 stroke-[3px] animate-pulse" />
      <text x="368" y="395" class="fill-white text-xs font-mono font-bold drop-shadow">
        Kapton Tape (94%)
      </text>
    </g>
  </svg>
</div>
```

---

## 8. Turnkey Packaging & Docker Setup

### Directory Layout
```
/spacegrep-app/
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── requirements.txt
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── ingestion.py
│   └── models.py
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── SearchBar.tsx
│       │   ├── ShelfViewer.tsx
│       │   ├── PhotoManager.tsx
│       │   └── HighlightOverlay.tsx
│       └── workers/
│           └── searchWorker.ts
└── data/                   <-- Mounted volume (gitignored)
    ├── inventory.db
    └── images/
```

### `Dockerfile`
Multi-stage build packaging Vite frontend into FastAPI backend:

```dockerfile
# Stage 1: Build Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Production Runtime
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy built frontend into static dir
COPY --from=frontend-builder /build/dist /app/static

# Copy backend code
COPY backend/ /app/backend/

ENV DATA_DIR=/app/data
ENV PORT=8000
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `docker-compose.yml`
```yaml
version: "3.8"

services:
  spacegrep-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: spacegrep-app
    restart: unless-stopped
    ports:
      - "80:8000"
    volumes:
      - ./data:/app/data
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - DATA_DIR=/app/data
```

---

## 9. Step-by-Step Subagent Task Checklist

Follow these sequential milestones to implement the application:

### Phase 1: Database & Backend Foundations
- [ ] Initialize Python virtual environment and install `fastapi`, `uvicorn`, `sqlite3`, `fastembed`, `pillow`, `pydantic`.
- [ ] Implement `backend/database.py` with tables `photos` and `bins`. Include WAL mode (`PRAGMA journal_mode=WAL;`).
- [ ] Implement `GET /api/manifest` serializing photos and bins with unpacked float embeddings.
- [ ] Implement `DELETE /api/photos/{photo_id}` to safely delete image assets and cascade DB records.

### Phase 2: Ingestion & Vision Pipeline
- [ ] Implement `backend/ingestion.py`.
- [ ] Create prompt template for Gemini 1.5 Flash structured output extracting normalized bounding boxes, labels, and 4 semantic keywords.
- [ ] Integrate `fastembed` model `BAAI/bge-small-en-v1.5` for local vector calculations.
- [ ] Wire up `POST /api/photos` upload handler to run ingestion, save thumbnails, and commit records.

### Phase 3: Frontend Foundation & Image Overlay
- [ ] Scaffold Vite + React + Tailwind CSS project in `/frontend`.
- [ ] Build `ShelfViewer.tsx` displaying the active shelf image with responsive SVG container overlay.
- [ ] Implement SVG coordinate mapping using normalized bounding boxes `[x, y, w, h]` across screen sizes.
- [ ] Build `PhotoManager.tsx` with drag-and-drop file upload, upload progress indicator, and photo deletion.

### Phase 4: Instant Hybrid Search Engine
- [ ] Create `frontend/src/workers/searchWorker.ts`.
- [ ] Configure `fuse.js` for instant character/subword literal matching against bin labels.
- [ ] Add `@xenova/transformers` for in-browser query vector calculation, or implement query caching.
- [ ] Write combination scoring function $\max(\text{Score}_{\text{literal}} \times 1.25, \text{Score}_{\text{semantic}})$.
- [ ] Connect input debounce (50ms) to search worker and pipe resulting match IDs to the SVG overlay.
- [ ] Add thumbnail shelf switcher showing match count badges (e.g. *"Shelf 1 (4 matches)"*).

### Phase 5: Containerization & Appliance Polish
- [ ] Create multi-stage `Dockerfile` and `docker-compose.yml`.
- [ ] Mount `./data` directory with sample shelf photos pre-loaded.
- [ ] Test Kiosk display mode on Chromium: ensure search box is autofocusing and keyboard shortcuts (`ESC` clears search, `TAB` switches shelves) work reliably.

---

## 10. Acceptance & Validation Tests

1. **OCR / Ingestion Precision:**
   * Upload the workshop photo with *"Kapton Tape & PVC Electrical Tape"*.
   * Verify that the database record contains a valid normalized bounding box directly surrounding that container.
2. **Literal Part Number Search:**
   * Type `CR2032` in the search bar.
   * Within 100ms, the *"CR2032 Batteries & Holders"* bin should pulse neon cyan with $> 0.85$ confidence.
3. **Semantic Query Match:**
   * Type `hot glue substitute` or `high heat wire wrap`.
   * The *"Kapton Tape"* bin must highlight above the 0.60 threshold.
   * Type `measure resistance`.
   * Both *"Multimeter Test Leads"* and *"Multimeters!"* bins must highlight.
4. **Resilience & State Persistence:**
   * Restart the Docker container (`docker compose restart`).
   * Confirm that all previously uploaded photos, labels, and vector highlights render immediately without re-ingesting.