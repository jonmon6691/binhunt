from typing import List, Optional
from pydantic import BaseModel, Field


class BinBase(BaseModel):
    label: str
    semantic_tags: List[str] = Field(default_factory=list)
    bbox: List[float] = Field(description="[x, y, w, h] normalized to 0.0 - 1.0")


class Bin(BinBase):
    id: str
    photo_id: str


class Photo(BaseModel):
    id: str
    filename: str
    original_name: str
    width: int
    height: int
    created_at: str
    bins: List[Bin] = Field(default_factory=list)


class ManifestResponse(BaseModel):
    photos: List[Photo]


class GeminiDetectedBin(BaseModel):
    box_2d: List[int] = Field(
        description="Bounding box [ymin, xmin, ymax, xmax] scaled 0 to 1000"
    )
    label: str = Field(description="Transcribed part/tool label on bin or shelf")
    semantic_tags: List[str] = Field(
        default_factory=list,
        description="3-5 functional keywords, synonyms, or use-cases",
    )


class UploadResponse(BaseModel):
    status: str
    photo: Photo


class SearchResult(BaseModel):
    photo_id: str
    bin_id: str
    label: str
    score: float
    confidence_tier: str  # "high" (>= 0.70) or "moderate" (0.50 - 0.69)
