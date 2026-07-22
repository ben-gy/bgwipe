// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * bgwipe inference worker.
 *
 * Owns the segmentation model and runs all CPU/GPU-heavy work off the main
 * thread. Communicates via comlink. Exposes:
 *   - subscribe(cb)     — register a progress callback
 *   - init()            — pre-warm the model (optional)
 *   - process(fileBlob) — run the full pipeline and return a result
 *
 * The model is RMBG-1.4 from BRIA, served via transformers.js. We try WebGPU
 * first and fall back to WASM if the device or browser doesn't support it.
 */

import * as Comlink from 'comlink';
import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
  type PreTrainedModel,
  type Processor,
} from '@huggingface/transformers';
import { applyAlphaMask, quantizeFloatMask, resizeMaskNearest } from './composite';
import type { ProcessResult, ProgressEvent } from './types';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = 'briaai/RMBG-1.4';

let modelPromise: Promise<{ model: PreTrainedModel; processor: Processor; device: 'webgpu' | 'wasm' }> | null = null;

let progressCb: ((e: ProgressEvent) => void) | null = null;

function emit(e: ProgressEvent): void {
  if (progressCb) {
    try {
      progressCb(e);
    } catch {
      // ignore broken subscriber
    }
  }
}

async function loadModel(): Promise<{
  model: PreTrainedModel;
  processor: Processor;
  device: 'webgpu' | 'wasm';
}> {
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    const t0 = performance.now();
    emit({
      stage: 'loading-model',
      fraction: 0,
      label: 'preparing model runtime',
    });

    const progressHook = (info: {
      status?: string;
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      if (info.status === 'progress' && typeof info.progress === 'number') {
        emit({
          stage: 'loading-model',
          fraction: info.progress / 100,
          label: `downloading ${info.file ?? 'model'}`,
          bytesLoaded: info.loaded,
          bytesTotal: info.total,
        });
      } else if (info.status === 'ready') {
        emit({
          stage: 'loading-model',
          fraction: 1,
          label: 'model ready',
          elapsedMs: performance.now() - t0,
        });
      } else if (info.status === 'download') {
        emit({
          stage: 'loading-model',
          fraction: 0,
          label: `fetching ${info.file ?? 'model'}`,
        });
      }
    };

    const tryWebGpu = typeof (globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu !== 'undefined';

    let device: 'webgpu' | 'wasm' = 'wasm';
    let model: PreTrainedModel;
    if (tryWebGpu) {
      try {
        model = await AutoModel.from_pretrained(MODEL_ID, {
          device: 'webgpu',
          dtype: 'fp32',
          progress_callback: progressHook,
        });
        device = 'webgpu';
      } catch (err) {
        emit({
          stage: 'loading-model',
          label: `WebGPU unavailable, falling back to WASM (${String((err as Error)?.message ?? err)})`,
        });
        model = await AutoModel.from_pretrained(MODEL_ID, {
          progress_callback: progressHook,
        });
        device = 'wasm';
      }
    } else {
      model = await AutoModel.from_pretrained(MODEL_ID, {
        progress_callback: progressHook,
      });
    }

    const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: progressHook,
    });

    emit({
      stage: 'loading-model',
      fraction: 1,
      label: `model loaded (${device})`,
      elapsedMs: performance.now() - t0,
    });
    return { model, processor, device };
  })();

  return modelPromise;
}

async function decodeBlob(blob: Blob): Promise<RawImage> {
  // RawImage.fromBlob handles JPEG/PNG/WebP/etc via the platform decoders.
  // In a worker context this uses createImageBitmap under the hood.
  return await RawImage.fromBlob(blob);
}

async function rawImageToPngBlob(img: RawImage): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  toRgba(img, rgba);
  const imageData = new ImageData(rgba, img.width, img.height);
  ctx.putImageData(imageData, 0, 0);
  return await canvas.convertToBlob({ type: 'image/png' });
}

function toRgba(img: RawImage, out: Uint8ClampedArray): void {
  const { data, channels, width, height } = img;
  const pixels = width * height;
  if (channels === 4) {
    out.set(data);
    return;
  }
  if (channels === 3) {
    for (let i = 0; i < pixels; i++) {
      out[i * 4 + 0] = data[i * 3 + 0];
      out[i * 4 + 1] = data[i * 3 + 1];
      out[i * 4 + 2] = data[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
    return;
  }
  if (channels === 1) {
    for (let i = 0; i < pixels; i++) {
      out[i * 4 + 0] = data[i];
      out[i * 4 + 1] = data[i];
      out[i * 4 + 2] = data[i];
      out[i * 4 + 3] = 255;
    }
    return;
  }
  throw new Error(`Unsupported channel count: ${channels}`);
}

async function compositeAlpha(
  source: RawImage,
  mask: Uint8Array,
): Promise<Blob> {
  const rgba = new Uint8ClampedArray(source.width * source.height * 4);
  toRgba(source, rgba);
  applyAlphaMask(rgba, mask, source.width, source.height);
  const canvas = new OffscreenCanvas(source.width, source.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
  const imageData = new ImageData(rgba, source.width, source.height);
  ctx.putImageData(imageData, 0, 0);
  return await canvas.convertToBlob({ type: 'image/png' });
}

async function process(blob: Blob): Promise<ProcessResult> {
  const tStart = performance.now();
  const { model, processor, device } = await loadModel();

  emit({ stage: 'decoding', label: 'decoding image', fraction: 0 });
  const tDecode = performance.now();
  const source = await decodeBlob(blob);
  emit({
    stage: 'decoding',
    label: `decoded ${source.width}×${source.height}`,
    fraction: 1,
    elapsedMs: performance.now() - tDecode,
  });

  emit({ stage: 'inferring', label: 'running model', fraction: 0 });
  const tInfer = performance.now();
  // RMBG-1.4 wants normalised inputs; the processor handles that.
  const inputs = await processor(source);
  const result = await model({ input: inputs.pixel_values });
  // RMBG-1.4 exposes the mask under "output". Fall back to the first tensor
  // if the field name varies between revisions.
  const tensor: unknown = (result as Record<string, unknown>).output ?? Object.values(result)[0];
  const inferMs = performance.now() - tInfer;
  emit({
    stage: 'inferring',
    label: `inference complete (${device})`,
    fraction: 1,
    elapsedMs: inferMs,
  });

  emit({ stage: 'compositing', label: 'building cutout', fraction: 0 });
  const tComp = performance.now();
  // Tensor shape: [1, 1, H, W] sigmoid-activated floats in [0,1].
  const t = tensor as { data: Float32Array; dims: number[] };
  const [, , mh, mw] = t.dims;
  const flatMask = quantizeFloatMask(t.data);
  const fullMask = resizeMaskNearest(flatMask, mw, mh, source.width, source.height);

  const pngBlob = await compositeAlpha(source, fullMask);
  const originalPngBlob = await rawImageToPngBlob(source);
  emit({
    stage: 'compositing',
    label: 'cutout ready',
    fraction: 1,
    elapsedMs: performance.now() - tComp,
  });
  emit({ stage: 'done', label: 'complete', fraction: 1 });

  return {
    pngBlob,
    originalPngBlob,
    width: source.width,
    height: source.height,
    totalMs: performance.now() - tStart,
    inferMs,
    device,
  };
}

const api = {
  subscribe(cb: (e: ProgressEvent) => void): void {
    progressCb = cb;
  },
  async init(): Promise<{ device: 'webgpu' | 'wasm' }> {
    const { device } = await loadModel();
    return { device };
  },
  process,
};

export type BgwipeWorker = typeof api;

Comlink.expose(api);
