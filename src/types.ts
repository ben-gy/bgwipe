// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
export type Stage =
  | 'idle'
  | 'loading-model'
  | 'decoding'
  | 'inferring'
  | 'compositing'
  | 'done'
  | 'error';

export interface ProgressEvent {
  stage: Stage;
  /** 0..1 — undefined means indeterminate */
  fraction?: number;
  /** human label */
  label?: string;
  /** bytes transferred (for model download) */
  bytesLoaded?: number;
  /** total bytes (for model download) */
  bytesTotal?: number;
  /** elapsed ms within this stage */
  elapsedMs?: number;
}

export interface ProcessResult {
  /** result PNG with transparent background */
  pngBlob: Blob;
  /** original decoded image as PNG (for the before/after comparison) */
  originalPngBlob: Blob;
  /** image width in pixels */
  width: number;
  /** image height in pixels */
  height: number;
  /** total time spent inside the worker in milliseconds */
  totalMs: number;
  /** time spent doing inference only */
  inferMs: number;
  /** which inference backend was used */
  device: 'webgpu' | 'wasm';
}

export interface WorkerError {
  message: string;
  stage: Stage;
}
