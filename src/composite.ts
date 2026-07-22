// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Pure pixel-buffer compositing helpers used by the worker.
 *
 * Kept free of any DOM / canvas / worker globals so that the math is unit
 * testable in vitest's jsdom environment.
 */

/**
 * Apply a single-channel alpha mask to an RGBA pixel buffer in place.
 *
 * Both buffers must describe the same dimensions. `mask` is expected to be a
 * `width*height`-length Uint8Array (or Uint8ClampedArray) of 0..255 values.
 * `rgba` is the standard 4-byte-per-pixel ImageData buffer.
 *
 * Returns the same `rgba` buffer for chaining.
 */
export function applyAlphaMask(
  rgba: Uint8ClampedArray,
  mask: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const pixels = width * height;
  if (rgba.length !== pixels * 4) {
    throw new Error(
      `applyAlphaMask: rgba length ${rgba.length} does not match width*height*4 (${pixels * 4})`,
    );
  }
  if (mask.length !== pixels) {
    throw new Error(
      `applyAlphaMask: mask length ${mask.length} does not match width*height (${pixels})`,
    );
  }
  for (let i = 0; i < pixels; i++) {
    rgba[i * 4 + 3] = mask[i];
  }
  return rgba;
}

/**
 * Resize a single-channel mask via nearest-neighbour sampling.
 *
 * Used to scale the model's fixed-size mask (e.g. 1024x1024) back up to the
 * user's original image dimensions before alpha compositing. Nearest-neighbour
 * is intentional: bilinear sampling on a binary-ish mask produces visible
 * fringing along the cutout edge. Nearest-neighbour stays crisp.
 */
export function resizeMaskNearest(
  src: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8Array {
  if (src.length !== srcWidth * srcHeight) {
    throw new Error(
      `resizeMaskNearest: src length ${src.length} does not match ${srcWidth}x${srcHeight}`,
    );
  }
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    return new Uint8Array(src);
  }
  const out = new Uint8Array(dstWidth * dstHeight);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;
  for (let y = 0; y < dstHeight; y++) {
    const sy = Math.min(srcHeight - 1, Math.floor(y * yRatio));
    const srcRow = sy * srcWidth;
    const dstRow = y * dstWidth;
    for (let x = 0; x < dstWidth; x++) {
      const sx = Math.min(srcWidth - 1, Math.floor(x * xRatio));
      out[dstRow + x] = src[srcRow + sx];
    }
  }
  return out;
}

/**
 * Stretch a [0,1]-valued Float32 mask into a 0..255 Uint8 buffer with
 * gamma-style clamping. The model output is a sigmoid-activated tensor, so
 * values are already in [0,1] but can have slight overshoot — clamp first.
 */
export function quantizeFloatMask(src: Float32Array | number[]): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v <= 0) out[i] = 0;
    else if (v >= 1) out[i] = 255;
    else out[i] = Math.round(v * 255);
  }
  return out;
}

/**
 * Estimate a tight bounding box around the non-transparent pixels of a mask.
 * Returns null if the mask is empty. Useful for reporting the cutout coverage
 * to the user ("kept 38% of the image").
 */
export function maskCoverage(mask: Uint8Array | Uint8ClampedArray): number {
  if (mask.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 128) sum++;
  }
  return sum / mask.length;
}
