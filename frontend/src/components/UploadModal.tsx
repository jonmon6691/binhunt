import React, { useState, useRef } from 'react';
import { X, UploadCloud, Trash2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { Photo } from '../types';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: Photo[];
  onUploadSuccess: (newPhoto: Photo) => void;
  onDeleteSuccess: (photoId: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  photos,
  onUploadSuccess,
  onDeleteSuccess,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }

    setIsUploading(true);
    setErrorMessage('');
    setUploadStatus('Uploading shelf image...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      setUploadStatus('Analyzing shelf with Vision AI (detecting bins & labels)...');
      const res = await fetch('/api/photos', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Upload and vision ingestion failed');
      }

      setUploadStatus('Saving records...');
      const data = await res.json();
      onUploadSuccess(data.photo);
      setUploadStatus('Ingestion complete!');
      setTimeout(() => {
        setIsUploading(false);
        setUploadStatus('');
      }, 1200);
    } catch (err: any) {
      console.error('Upload error:', err);
      setErrorMessage(err.message || 'An error occurred during ingestion.');
      setIsUploading(false);
      setUploadStatus('');
    }
  };

  const handleDelete = async (photoId: string) => {
    if (!window.confirm('Are you sure you want to delete this shelf photo and all its indexed bins?')) {
      return;
    }

    setDeletingId(photoId);
    try {
      const res = await fetch(`/api/photos/${photoId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete photo');
      onDeleteSuccess(photoId);
    } catch (err: any) {
      alert(err.message || 'Error deleting photo');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
              <span>Shelf Photo Management</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Upload shelf photos for automated bin detection or manage existing shelves
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Drag & Drop Area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.[0]) {
                handleFile(e.dataTransfer.files[0]);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
              isDragging
                ? 'border-cyan-400 bg-cyan-950/20'
                : 'border-slate-700 hover:border-cyan-500/50 bg-slate-800/40 hover:bg-slate-800/70'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFile(e.target.files[0]);
                }
              }}
            />

            {isUploading ? (
              <div className="flex flex-col items-center space-y-3 py-2">
                <Loader2 className="w-9 h-9 text-cyan-400 animate-spin" />
                <p className="text-sm font-medium text-cyan-300 font-mono">{uploadStatus}</p>
                <p className="text-xs text-slate-400">Gemini VLM is analyzing bounding boxes and tags...</p>
              </div>
            ) : (
              <>
                <UploadCloud className="w-10 h-10 text-slate-400 mb-3" />
                <p className="text-sm font-medium text-slate-200">
                  Drag and drop a new shelf photo here, or <span className="text-cyan-400 underline">browse</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Supports high-resolution JPEG, PNG, or WebP. Bins and labels are auto-detected.
                </p>
              </>
            )}
          </div>

          {errorMessage && (
            <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Seed Drop Folder Info Tip */}
          <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 flex items-start space-x-2.5">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-200">Drop Folder Auto-Ingest:</span>
              <p className="text-slate-400 mt-0.5">
                You can also drop shelf photos directly into <code className="text-cyan-300 font-mono px-1 py-0.5 bg-slate-900 rounded">./data/seed_photos/</code> on the host machine. The server automatically ingests new files on startup.
              </p>
            </div>
          </div>

          {/* Existing Shelves List */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 font-mono">
              Indexed Workshop Shelves ({photos.length})
            </h3>
            {photos.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No shelves added yet.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/60 hover:border-slate-600 transition-colors"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <img
                        src={`/images/thumb_${photo.filename}`}
                        alt={photo.original_name}
                        className="w-12 h-9 object-cover rounded bg-slate-950 border border-slate-700 flex-shrink-0"
                        onError={(e) => {
                          // Fallback to main image if thumb is missing
                          (e.target as HTMLImageElement).src = `/images/${photo.filename}`;
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">{photo.original_name}</p>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {photo.bins.length} bins &bull; {photo.width}&times;{photo.height}px
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(photo.id)}
                      disabled={deletingId === photo.id}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors disabled:opacity-50"
                      title="Delete shelf photo"
                    >
                      {deletingId === photo.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-slate-800 bg-slate-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
