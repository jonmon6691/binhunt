import React, { useState, useRef } from 'react';
import { X, UploadCloud, Trash2, CheckCircle2, AlertCircle, Loader2, Lock, Sparkles, Layers } from 'lucide-react';
import type { Photo, IngestJobState } from '../types';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: Photo[];
  onUploadSuccess: (newPhoto: Photo) => void;
  onDeleteSuccess: (photoId: string) => void;
}

const TOKEN_STORAGE_KEY = 'spacegrep_admin_token';

function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {}
}

function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {}
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
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStage, setUploadStage] = useState<string>('preparing');
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [uploadEncouragement, setUploadEncouragement] = useState<string>('');
  const [uploadBinsCount, setUploadBinsCount] = useState<number>(0);
  const [uploadTiles, setUploadTiles] = useState<{ current: number; total: number }>({ current: 0, total: 1 });
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Admin password prompt state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDeletePhoto, setPendingDeletePhoto] = useState<Photo | null>(null);
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const executeUpload = async (file: File, token: string) => {
    setIsUploading(true);
    setPasswordError('');
    setUploadProgress(5);
    setUploadStage('preparing');
    setUploadMessage('Uploading shelf image...');
    setUploadEncouragement('Sending your shelf image to the workshop server...');
    setUploadBinsCount(0);
    setUploadTiles({ current: 0, total: 1 });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/photos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        if (res.status === 401) {
          clearStoredToken();
          setPendingFile(file);
          setPasswordError('Admin session expired. Please enter password again.');
          setIsUploading(false);
          return;
        }
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Upload and vision ingestion failed');
      }

      const resData = await res.json();

      // Synchronous fallback handling (e.g. if sync=true or direct return)
      if (res.status === 201 && resData.photo) {
        setUploadProgress(100);
        setUploadStage('complete');
        setUploadEncouragement(`Success! ${resData.photo.bins.length} bins indexed!`);
        onUploadSuccess(resData.photo);
        setTimeout(() => {
          setIsUploading(false);
          setPendingFile(null);
          setPasswordInput('');
        }, 1200);
        return;
      }

      // Asynchronous ingestion handling (HTTP 202)
      const jobId = resData.job_id;
      if (!jobId) {
        throw new Error('No job ID returned by server');
      }

      // Connect to SSE stream for live progress updates
      await new Promise<void>((resolve, reject) => {
        let isResolved = false;
        const es = new EventSource(`/api/ingest/jobs/${jobId}/stream`);

        const cleanup = () => {
          if (!isResolved) {
            isResolved = true;
            es.close();
          }
        };

        es.onmessage = (event) => {
          try {
            const job: IngestJobState = JSON.parse(event.data);
            setUploadProgress(job.progress);
            setUploadStage(job.stage);
            setUploadMessage(job.message);
            setUploadEncouragement(job.encouragement);
            setUploadBinsCount(job.bins_count);
            if (job.total_tiles) {
              setUploadTiles({ current: job.completed_tiles, total: job.total_tiles });
            }

            if (job.status === 'completed' && job.photo_record) {
              cleanup();
              onUploadSuccess(job.photo_record);
              setTimeout(() => {
                setIsUploading(false);
                setPendingFile(null);
                setPasswordInput('');
                resolve();
              }, 1200);
            } else if (job.status === 'failed') {
              cleanup();
              reject(new Error(job.error || 'Ingestion failed on the server'));
            }
          } catch (e) {
            console.error('Error parsing SSE message:', e);
          }
        };

        es.onerror = () => {
          // Fallback to polling if SSE is interrupted
          cleanup();
          const pollTimer = setInterval(async () => {
            try {
              const pollRes = await fetch(`/api/ingest/jobs/${jobId}`);
              if (!pollRes.ok) return;
              const job: IngestJobState = await pollRes.json();
              setUploadProgress(job.progress);
              setUploadStage(job.stage);
              setUploadMessage(job.message);
              setUploadEncouragement(job.encouragement);
              setUploadBinsCount(job.bins_count);

              if (job.status === 'completed' && job.photo_record) {
                clearInterval(pollTimer);
                onUploadSuccess(job.photo_record);
                setTimeout(() => {
                  setIsUploading(false);
                  setPendingFile(null);
                  setPasswordInput('');
                  resolve();
                }, 1200);
              } else if (job.status === 'failed') {
                clearInterval(pollTimer);
                reject(new Error(job.error || 'Ingestion failed'));
              }
            } catch (err) {
              clearInterval(pollTimer);
              reject(err);
            }
          }, 1500);
        };
      });
    } catch (err: any) {
      console.error('Upload error:', err);
      setErrorMessage(err.message || 'An error occurred during ingestion.');
      setIsUploading(false);
    }
  };

  const executeDelete = async (photo: Photo, token: string) => {
    setIsDeleting(true);
    setPasswordError('');

    try {
      const res = await fetch(`/api/photos/${photo.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          clearStoredToken();
          setPendingDeletePhoto(photo);
          setPasswordError('Admin session expired. Please enter password again.');
          setIsDeleting(false);
          return;
        }
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete photo');
      }

      onDeleteSuccess(photo.id);
      setPendingDeletePhoto(null);
      setPasswordInput('');
    } catch (err: any) {
      console.error('Delete error:', err);
      setPasswordError(err.message || 'An error occurred while deleting.');
    } finally {
      setIsDeleting(false);
    }
  };

  const selectFileForUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (JPEG, PNG, or WebP).');
      return;
    }
    setErrorMessage('');
    setPasswordError('');
    setPasswordInput('');
    setPendingDeletePhoto(null);

    const token = getStoredToken();
    if (token) {
      executeUpload(file, token);
    } else {
      setPendingFile(file);
    }
  };

  const requestDelete = (photo: Photo) => {
    setErrorMessage('');
    setPasswordError('');
    setPasswordInput('');
    setPendingFile(null);

    const token = getStoredToken();
    if (token) {
      executeDelete(photo, token);
    } else {
      setPendingDeletePhoto(photo);
    }
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

    try {
      if (pendingFile) {
        setIsUploading(true);
        setUploadMessage('Authenticating admin password...');
        setUploadEncouragement('Verifying admin credentials...');
      } else if (pendingDeletePhoto) {
        setIsDeleting(true);
      }
      setPasswordError('');

      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: passwordInput }),
      });

      if (!loginRes.ok) {
        const errorData = await loginRes.json().catch(() => ({}));
        if (loginRes.status === 429) {
          setPasswordError(errorData.detail || 'Too many failed attempts. Please wait 5 minutes.');
        } else {
          setPasswordError(errorData.detail || 'Invalid admin password. Please try again.');
        }
        setIsUploading(false);
        setIsDeleting(false);
        setUploadMessage('');
        return;
      }

      const loginData = await loginRes.json();
      const token = loginData.token;
      setStoredToken(token);

      if (pendingFile) {
        const fileToUpload = pendingFile;
        setPendingFile(null);
        setPasswordInput('');
        setPasswordError('');
        await executeUpload(fileToUpload, token);
      } else if (pendingDeletePhoto) {
        const photoToDelete = pendingDeletePhoto;
        setPendingDeletePhoto(null);
        setPasswordInput('');
        setPasswordError('');
        await executeDelete(photoToDelete, token);
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      setPasswordError(err.message || 'Authentication failed');
      setIsUploading(false);
      setIsDeleting(false);
      setUploadMessage('');
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
              <div className="flex flex-col items-center w-full max-w-md py-4 space-y-4">
                {/* Stage Badge & Animated Loader */}
                <div className="flex items-center space-x-2">
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                  <span className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-300 bg-cyan-950/80 border border-cyan-800/80 px-2.5 py-1 rounded-full">
                    {uploadStage === 'preparing' && 'Step 1/4: Preparing Image'}
                    {uploadStage === 'vision_ai' && 'Step 2/4: Gemini Vision AI'}
                    {uploadStage === 'deduplication' && 'Step 3/4: Spatial Fusion'}
                    {uploadStage === 'saving' && 'Step 4/4: Indexing Database'}
                    {uploadStage === 'complete' && 'Ingestion Complete!'}
                    {uploadStage === 'queued' && 'Queued in Ingestion Worker'}
                  </span>
                </div>

                {/* Progress Bar & Percentage */}
                <div className="w-full space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-slate-300 truncate max-w-[280px]">{uploadMessage}</span>
                    <span className="text-cyan-300 font-bold">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-700/80">
                    <div
                      className="bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${Math.max(5, uploadProgress)}%` }}
                    />
                  </div>
                </div>

                {/* Encouraging Feedback Card */}
                <div className="w-full bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 border border-cyan-800/50 rounded-xl p-3.5 flex items-start space-x-3 shadow-inner text-left">
                  <div className="p-2 rounded-lg bg-cyan-900/50 border border-cyan-700/60 text-cyan-300 flex-shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-cyan-200">AI Workshop Assistant</p>
                    <p className="text-xs text-slate-300 mt-0.5 leading-relaxed font-sans">
                      {uploadEncouragement || 'Carefully inspecting your workshop storage bins...'}
                    </p>
                    {uploadBinsCount > 0 && (
                      <div className="flex items-center space-x-2 mt-2 pt-2 border-t border-cyan-900/40 text-[11px] font-mono text-cyan-400">
                        <Layers className="w-3.5 h-3.5" />
                        <span>{uploadBinsCount} bins detected so far</span>
                        {uploadTiles.total > 1 && (
                          <span className="text-slate-400">
                            &bull; Tile {uploadTiles.current} of {uploadTiles.total}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
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
                      Password is set in <code className="text-cyan-300 font-mono">.env</code> and grants a 1-hour Bearer token session.
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
