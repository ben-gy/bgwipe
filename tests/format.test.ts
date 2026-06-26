import { describe, expect, it } from 'vitest';
import {
  clampDimension,
  formatBytes,
  formatMs,
  formatPercent,
  isSupportedImage,
  suggestedOutputName,
} from '../src/format';

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });
  it('formats KB / MB / GB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });
  it('rounds large values without decimals', () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
  });
  it('returns em-dash for invalid input', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Infinity)).toBe('—');
  });
});

describe('formatMs', () => {
  it('formats sub-second values in ms', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(999)).toBe('999 ms');
    expect(formatMs(123.7)).toBe('124 ms');
  });
  it('formats seconds with one decimal', () => {
    expect(formatMs(1500)).toBe('1.5 s');
    expect(formatMs(59000)).toBe('59.0 s');
  });
  it('formats minutes', () => {
    expect(formatMs(60_000)).toBe('1m 0s');
    expect(formatMs(125_000)).toBe('2m 5s');
  });
  it('handles bad inputs', () => {
    expect(formatMs(NaN)).toBe('—');
    expect(formatMs(-1)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('rounds and adds % sign', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.123)).toBe('12%');
  });
  it('clamps to [0, 1]', () => {
    expect(formatPercent(-0.5)).toBe('0%');
    expect(formatPercent(1.5)).toBe('100%');
  });
  it('handles invalid input', () => {
    expect(formatPercent(NaN)).toBe('—');
  });
});

describe('clampDimension', () => {
  it('returns unchanged when below max', () => {
    expect(clampDimension(800, 600, 1024)).toEqual({ width: 800, height: 600, scale: 1 });
  });
  it('scales down landscape preserving aspect', () => {
    const r = clampDimension(4000, 2000, 1000);
    expect(r.width).toBe(1000);
    expect(r.height).toBe(500);
    expect(r.scale).toBeCloseTo(0.25);
  });
  it('scales down portrait preserving aspect', () => {
    const r = clampDimension(1000, 4000, 1000);
    expect(r.width).toBe(250);
    expect(r.height).toBe(1000);
  });
  it('handles square exact-fit', () => {
    expect(clampDimension(1024, 1024, 1024)).toEqual({ width: 1024, height: 1024, scale: 1 });
  });
});

describe('isSupportedImage', () => {
  it('accepts common image mime types', () => {
    expect(isSupportedImage({ type: 'image/jpeg' })).toBe(true);
    expect(isSupportedImage({ type: 'image/png' })).toBe(true);
    expect(isSupportedImage({ type: 'image/webp' })).toBe(true);
    expect(isSupportedImage({ type: 'IMAGE/JPEG' })).toBe(true);
  });
  it('falls back to file extension when mime is empty', () => {
    expect(isSupportedImage({ type: '', name: 'photo.jpg' })).toBe(true);
    expect(isSupportedImage({ type: '', name: 'cover.PNG' })).toBe(true);
    expect(isSupportedImage({ type: '', name: 'a.webp' })).toBe(true);
  });
  it('rejects non-image types', () => {
    expect(isSupportedImage({ type: 'application/pdf', name: 'doc.pdf' })).toBe(false);
    expect(isSupportedImage({ type: 'image/gif', name: 'meme.gif' })).toBe(false);
    expect(isSupportedImage({ type: '', name: 'note.txt' })).toBe(false);
  });
});

describe('suggestedOutputName', () => {
  it('appends -cutout.png to a basic name', () => {
    expect(suggestedOutputName('cat.jpg')).toBe('cat-cutout.png');
  });
  it('handles names without an extension', () => {
    expect(suggestedOutputName('photo')).toBe('photo-cutout.png');
  });
  it('strips unsafe characters', () => {
    expect(suggestedOutputName('a/b\\c:d*.jpg')).toBe('a_b_c_d_-cutout.png');
  });
  it('truncates very long basenames', () => {
    const long = 'a'.repeat(150) + '.png';
    const out = suggestedOutputName(long);
    expect(out.length).toBeLessThanOrEqual(80 + '-cutout.png'.length);
    expect(out.endsWith('-cutout.png')).toBe(true);
  });
  it('falls back to bgwipe.png when input is undefined', () => {
    expect(suggestedOutputName(undefined)).toBe('bgwipe.png');
  });
  it('falls back to a safe name when input becomes empty after sanitisation', () => {
    expect(suggestedOutputName('///.jpg')).toBe('image-cutout.png');
  });
});
