import React, { useState, useRef } from 'react';
import { X, UploadCloud, Trash2, CheckCircle2, AlertCircle, Loader2, Lock } from 'lucide-react';
import type { Photo } from '../types';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: Photo[];
  onUploadSuccess: (newPhoto: Photo) => void;
  onDeleteSuccess: (photoId: string) => void;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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

  // Admin password prompt state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDeletePhoto, setPendingDeletePhoto] = useState<Photo | null>(null);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const selectFileForUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }
    setErrorMessage('');
    setPasswordError('');
    setPasswordInput('');
    setPendingDeletePhoto(null);
    setPendingFile(file);
  };

  const requestDelete = (photo: Photo) => {
    setErrorMessage('');
    setPasswordError('');
    setPasswordInput('');
    setPendingFile(null);
    setPendingDeletePhoto(photo);
  };

  const cancelPasswordPrompt = () => {
    setPendingFile(null);
    setPendingDeletePhoto(null);
    setPasswordInput('');
    setPasswordError('');
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;

    if (pendingFile) {
      setIsUploading(true);
      setPasswordError('');
      setUploadStatus('Hashing admin password...');

      try {
        const passwordHash = await hashPassword(passwordInput);

        setUploadStatus('Uploading shelf image...');
        const formData = new FormData();
        formData.append('file', pendingFile);

        setUploadStatus('Analyzing shelf with Vision AI (detecting bins & labels)...');
        const res = await fetch('/api/photos', {
          method: 'POST',
          headers: {
            'X-Admin-Password-Hash': passwordHash,
          },
          body: formData,
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          if (res.status === 401) {
            setPasswordError(errorData.detail || 'Invalid admin password. Please try again.');
            setIsUploading(false);
            setUploadStatus('');
            return;
          }
          throw new Error(errorData.detail || 'Upload and vision ingestion failed');
        }

        setUploadStatus('Saving records...');
        const data = await res.json();
        onUploadSuccess(data.photo);
        setUploadStatus('Ingestion complete!');
        setTimeout(() => {
          setIsUploading(false);
          setUploadStatus('');
          setPendingFile(null);
          setPasswordInput('');
        }, 1200);
      } catch (err: any) {
        console.error('Upload error:', err);
        setPasswordError(err.message || 'An error occurred during ingestion.');
        setIsUploading(false);
        setUploadStatus('');
      }
    } else if (pendingDeletePhoto) {
      setIsDeleting(true);
      setPasswordError('');

      try {
        const passwordHash = await hashPassword(passwordInput);
        const res = await fetch(`/api/photos/${pendingDeletePhoto.id}`, {
          method: 'DELETE',
          headers: {
            'X-Admin-Password-Hash': passwordHash,
          },
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          if (res.status === 401) {
            setPasswordError(errorData.detail || 'Invalid admin password. Please try again.');
            setIsDeleting(false);
            return;
          }
          throw new Error(errorData.detail || 'Failed to delete photo');
        }

        onDeleteSuccess(pendingDeletePhoto.id);
        setPendingDeletePhoto(null);
        setPasswordInput('');
      } catch (err: any) {
        console.error('Delete error:', err);
        setPasswordError(err.message || 'An error occurred while deleting.');
      } finally {
        setIsDeleting(false);
      }
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
            onClick={() => {
              cancelPasswordPrompt();
              onClose();
            }}
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
                selectFileForUpload(e.dataTransfer.files[0]);
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
                  selectFileForUpload(e.target.files[0]);
                  e.target.value = '';
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
                      onClick={() => requestDelete(photo)}
                      disabled={isDeleting || isUploading}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors disabled:opacity-50"
                      title="Delete shelf photo"
                    >
                      <Trash2 className="w-4 h-4" />
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
            onClick={() => {
              cancelPasswordPrompt();
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>

        {/* Admin Password Prompt Dialog Overlay */}
        {(pendingFile || pendingDeletePhoto) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
              <div className="flex items-center space-x-3">
                <div
                  className={`p-2.5 rounded-xl border flex-shrink-0 ${
                    pendingDeletePhoto
                      ? 'bg-red-950/70 border-red-800/60 text-red-400'
                      : 'bg-cyan-950/70 border-cyan-800/60 text-cyan-400'
                  }`}
                >
                  {pendingDeletePhoto ? <Trash2 className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">Admin Authentication</h3>
                  <p className="text-xs text-slate-400">
                    {pendingDeletePhoto
                      ? 'Enter admin password to delete shelf photo'
                      : 'Enter admin password to upload shelf photo'}
                  </p>
                </div>
              </div>

              <div className="text-xs text-slate-400 bg-slate-800/50 p-3 rounded-xl border border-slate-700/60">
                {pendingDeletePhoto ? (
                  <>
                    <p className="font-mono text-slate-300 truncate">
                      <span className="text-slate-500">Delete:</span> {pendingDeletePhoto.original_name}
                    </p>
                    <p className="text-[11px] text-red-400 mt-1">
                      Warning: This will permanently delete this shelf photo and all {pendingDeletePhoto.bins.length} indexed bins.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-mono text-slate-300 truncate">
                      <span className="text-slate-500">File:</span> {pendingFile?.name}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Password is set in <code className="text-cyan-300 font-mono">.env</code> and hashed on the client before transmission.
                    </p>
                  </>
                )}
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Admin Password
                  </label>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      setPasswordError('');
                    }}
                    placeholder="Enter admin password..."
                    autoFocus
                    disabled={isUploading || isDeleting}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                  {passwordError && (
                    <div className="flex items-center space-x-1.5 mt-2 text-xs text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{passwordError}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={cancelPasswordPrompt}
                    disabled={isUploading || isDeleting}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUploading || isDeleting || !passwordInput.trim()}
                    className={`px-4 py-2 rounded-xl text-white text-xs font-medium transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                      pendingDeletePhoto
                        ? 'bg-red-600 hover:bg-red-500 shadow-red-950/50'
                        : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-950/50'
                    }`}
                  >
                    {isUploading || isDeleting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{pendingDeletePhoto ? 'Deleting...' : 'Verifying & Uploading...'}</span>
                      </>
                    ) : (
                      <span>{pendingDeletePhoto ? 'Confirm & Delete' : 'Confirm & Upload'}</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
