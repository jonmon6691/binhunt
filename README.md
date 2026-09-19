# Hackerspace Visual Inventory Locator

A lightweight, self-contained visual inventory search appliance for hackerspaces, maker workshops, and electronics labs. It overlays high-resolution photos of component shelves, bins, and organizers with a real-time (< 50ms) hybrid (literal + semantic) search interface.

![Demo](docs/demo.jpg)

---

## Key Features

- **Dynamic photo use** Upload or remove photos in the app. New photos are automatically indexed in seconds.
- **Real-Time Keystroke Highlighting (< 50ms):** Bounding boxes highlight dynamically as you type via a dedicated Web Worker running `@xenova/transformers` (Wasm `Xenova/all-MiniLM-L6-v2`) and `Fuse.js` purely in the browser. Zero server search load.
- **Hybrid Search (Literal + Semantic):**
  - **Literal:** Instant exact/fuzzy matches on part numbers and labels (`CR2032`, `ESP32`, `WLC100`, `Kapton`, `MOSFET`).
  - **Semantic:** Finds bins by functional intent or colloquial concept (`measure voltage` highlights Multimeters; `fix static shock` highlights ESD Wristbands; `heat resistant tape` highlights Kapton Tape).
- **Visual Confidence:** Match confidence is displayed as a % and the highest confidence results are highlighted.
- **Kiosk Auto-Reset:** Configurable 60-second inactivity reset timer for shared workshop terminals. Clears the search bar and smoothly scrolls to top when idle.
- **Appliance-Grade Deployment:** Single Docker container with a single `./data` host directory mount storing the SQLite database (`inventory.db`), processed images, and seed photos.

---

## Quick Start (Local Development)

### 1. Requirements
- Python 3.11+
- Node.js 20+

### 2. Setup Environment
```bash
# Clone repository and enter directory
cd binhunt

# Create Python virtual environment and install backend dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Install frontend dependencies and build static assets
cd frontend
npm install
npm run build
cd ..
```

### 3. Configure Gemini API Key (Optional)
Create a `.env` file from the template:
```bash
cp .env.example .env
```
Add your Gemini API key (obtainable from [Google AI Studio](https://aistudio.google.com/apikey)):
```bash
GEMINI_API_KEY=AIzaSy...
```
*(Note: If `GEMINI_API_KEY` is omitted, the app will run in offline mode using synthetic workshop bins so you can develop and test without cloud access).*

### 4. Run the Appliance
```bash
make run
```
Open your browser to:
```
http://localhost:8000
```

---

## Running with Docker Compose

For a turnkey deployment on a workshop NUC, Raspberry Pi, or local server:

```bash
# 1. Provide your GEMINI_API_KEY in .env
echo "GEMINI_API_KEY=AIzaSy..." > .env

# 2. Build and start container
docker compose up -d
```
Access the application at `http://localhost:8000` (or `http://inventory.local:8000` if mDNS is configured on your LAN).

All database records, images, and seed photos persist on the host under `./data/`.

---

## Ingesting Workshop Photos

There are two easy ways to add photos of your workshop shelves:

### Method 1: Drop Folder (Automated on Boot)
1. Place any shelf photos (`.jpg`, `.png`, `.webp`) into:
   ```
   ./data/seed_photos/
   ```
2. Restart the app (or run `make seed`).
3. The server scans for unindexed photos, calls Gemini Flash to detect bins and transcribe labels, calculates 384-dimensional vector embeddings, and registers them in SQLite.

### Method 2: In-App Drag and Drop
1. Click **Upload Shelf** in the top omnibar.
2. Drag and drop any shelf photo.
3. Watch the real-time progress indicator as Gemini detects bounding boxes and computes embeddings. The shelf will appear in the stream immediately.

---

## Keyboard Shortcuts

| Key | Context | Action |
| --- | --- | --- |
| `/` | Global | Focus search bar from anywhere and select query text |
| `Escape` | Global | Clear search query and blur search bar |
| `Enter` | Search Bar | Defocus search and smoothly center the first or active match |
| `n` | Global (outside search) | Cycle to the next matching bin and center it (vi/less style) |
| `N` / `Shift + n` | Global (outside search) | Cycle to the previous matching bin and center it (vi/less style) |
| `Space` | Global (outside search) | Smoothly scroll to the next shelf image boundary below the search bar |
| `Shift + Space` | Global (outside search) | Smoothly scroll to the previous shelf image boundary (or snap to top of current) |
| `q` / `Q` | Global (outside search) | Quick reset: clear search, scroll to top, and reset kiosk timer |

*(Tip: You can also click any off-screen **Radar Arrow** indicator or shelf match badge to smoothly scroll and center that bin).*

---

## Testing

Run the automated backend test suite:
```bash
make test
```
Verifies:
- SQLite persistence and cascading deletes
- Float32 embedding vector serialization & deserialization
- Normalized coordinate mapping ($0..1000 \rightarrow 0.0..1.0$)
- Ingestion pipeline and startup auto-seed scanner
