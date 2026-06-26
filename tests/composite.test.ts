import { describe, expect, it } from 'vitest';
import {
  applyAlphaMask,
  maskCoverage,
  quantizeFloatMask,
  resizeMaskNearest,
} from '../src/composite';

describe('applyAlphaMask', () => {
  it('writes mask values into the alpha channel of rgba', () => {
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]);
    const mask = new Uint8Array([0, 128, 255, 64]);
    applyAlphaMask(rgba, mask, 2, 2);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(128);
    expect(rgba[11]).toBe(255);
    expect(rgba[15]).toBe(64);
    // RGB values must be preserved
    expect(rgba[0]).toBe(10);
    expect(rgba[5]).toBe(50);
    expect(rgba[10]).toBe(90);
  });

  it('throws if rgba length does not match dimensions', () => {
    expect(() => applyAlphaMask(new Uint8ClampedArray(7), new Uint8Array(4), 2, 2)).toThrow(/rgba length/);
  });

  it('throws if mask length does not match dimensions', () => {
    expect(() => applyAlphaMask(new Uint8ClampedArray(16), new Uint8Array(3), 2, 2)).toThrow(/mask length/);
  });

  it('handles a 1x1 image', () => {
    const rgba = new Uint8ClampedArray([200, 100, 50, 255]);
    applyAlphaMask(rgba, new Uint8Array([42]), 1, 1);
    expect(rgba[3]).toBe(42);
  });

  it('handles a fully transparent mask', () => {
    const rgba = new Uint8ClampedArray(16).fill(255);
    applyAlphaMask(rgba, new Uint8Array(4), 2, 2);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(0);
    expect(rgba[11]).toBe(0);
    expect(rgba[15]).toBe(0);
  });
});

describe('resizeMaskNearest', () => {
  it('returns a copy when dimensions match', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const out = resizeMaskNearest(src, 2, 2, 2, 2);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    // Mutating out should not affect src
    out[0] = 99;
    expect(src[0]).toBe(1);
  });

  it('doubles a 2x2 mask to 4x4', () => {
    const src = new Uint8Array([0, 255, 128, 64]);
    const out = resizeMaskNearest(src, 2, 2, 4, 4);
    // Top-left 2x2 should be 0, top-right 2x2 should be 255, etc.
    expect(out.length).toBe(16);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(255);
    expect(out[3]).toBe(255);
    expect(out[8]).toBe(128);
    expect(out[12]).toBe(128);
    expect(out[15]).toBe(64);
  });

  it('downsamples a 4x4 to 2x2', () => {
    // Block of 4 unique values
    const src = new Uint8Array([
      10, 10, 20, 20,
      10, 10, 20, 20,
      30, 30, 40, 40,
      30, 30, 40, 40,
    ]);
    const out = resizeMaskNearest(src, 4, 4, 2, 2);
    expect(Array.from(out)).toEqual([10, 20, 30, 40]);
  });

  it('throws if src length does not match dimensions', () => {
    expect(() => resizeMaskNearest(new Uint8Array(5), 2, 2, 4, 4)).toThrow(/src length/);
  });

  it('handles non-uniform resize', () => {
    const src = new Uint8Array([100, 200]);
    const out = resizeMaskNearest(src, 2, 1, 4, 1);
    expect(Array.from(out)).toEqual([100, 100, 200, 200]);
  });
});

describe('quantizeFloatMask', () => {
  it('clamps and scales 0..1 floats to 0..255 ints', () => {
    const out = quantizeFloatMask([0, 0.5, 1]);
    expect(Array.from(out)).toEqual([0, 128, 255]);
  });

  it('clamps overshoot', () => {
    const out = quantizeFloatMask([-0.2, 1.4, 0.999, 0.001]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
    expect(out[2]).toBeGreaterThanOrEqual(254);
    expect(out[3]).toBeLessThanOrEqual(1);
  });

  it('works with Float32Array', () => {
    const f = new Float32Array([0.1, 0.7]);
    const out = quantizeFloatMask(f);
    expect(out[0]).toBeGreaterThan(20);
    expect(out[0]).toBeLessThan(30);
    expect(out[1]).toBeGreaterThan(170);
    expect(out[1]).toBeLessThan(190);
  });

  it('returns empty array for empty input', () => {
    expect(quantizeFloatMask([]).length).toBe(0);
  });
});

describe('maskCoverage', () => {
  it('reports 0 for an empty mask', () => {
    expect(maskCoverage(new Uint8Array(0))).toBe(0);
  });

  it('reports 0 for a fully transparent mask', () => {
    expect(maskCoverage(new Uint8Array(100))).toBe(0);
  });

  it('reports 1 for a fully opaque mask', () => {
    expect(maskCoverage(new Uint8Array(100).fill(255))).toBe(1);
  });

  it('reports half for a half-opaque mask', () => {
    const mask = new Uint8Array(100);
    for (let i = 0; i < 50; i++) mask[i] = 255;
    expect(maskCoverage(mask)).toBeCloseTo(0.5, 3);
  });

  it('treats <=128 as transparent for coverage purposes', () => {
    const mask = new Uint8Array([128, 129, 0, 200]);
    // 129 and 200 count; that's 2/4
    expect(maskCoverage(mask)).toBe(0.5);
  });
});
