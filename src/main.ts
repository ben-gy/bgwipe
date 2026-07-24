// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * bgwipe — application entry point.
 *
 * Wires the worker, drop zone, progress view, and result view together.
 * Owns the state machine: idle → processing → done | error.
 */

import * as Comlink from 'comlink';
import type { Remote } from 'comlink';
import { mountEventDrawer, emit as logEmit } from './eventlog';
import {
  openModal,
  renderEmpty,
  renderProgress,
  renderResult,
  toast,
  wireModalTriggers,
  type ProgressView,
} from './ui';
import { formatBytes, formatPercent, suggestedOutputName } from './format';
import type { ProcessResult, ProgressEvent, Stage } from './types';

type WorkerApi = {
  subscribe(cb: (e: ProgressEvent) => void): void;
  init(): Promise<{ device: 'webgpu' | 'wasm' }>;
  process(blob: Blob): Promise<ProcessResult>;
};

const STAGE_LABEL: Record<Stage, string> = {
  idle: 'idle',
  'loading-model': 'preparing model',
  decoding: 'decoding image',
  inferring: 'running model',
  compositing: 'building cutout',
  done: 'done',
  error: 'error',
};

class App {
  private workbench: HTMLElement;
  private workerApi: Remote<WorkerApi> | null = null;
  private progressView: ProgressView | null = null;
  private currentFile: File | null = null;
  private lastResult: ProcessResult | null = null;
  private busy = false;

  constructor() {
    const root = document.getElementById('workbench');
    if (!root) throw new Error('#workbench not found in document');
    this.workbench = root;
  }

  start(): void {
    wireModalTriggers();
    this.wireDrawer();
    this.wireKeyboard();
    this.mountEmpty();
    logEmit('system', 'ok', 'bgwipe ready', { build: '1.0.0' });
  }

  private wireDrawer(): void {
    const toggle = document.getElementById('drawer-toggle') as HTMLButtonElement | null;
    const drawer = document.getElementById('event-drawer');
    if (!toggle || !drawer) return;
    let mounted = false;
    let unmount: (() => void) | null = null;
    toggle.addEventListener('click', () => {
      const open = drawer.hasAttribute('hidden');
      if (open) {
        drawer.removeAttribute('hidden');
        toggle.setAttribute('aria-expanded', 'true');
        if (!mounted) {
          unmount = mountEventDrawer(drawer);
          mounted = true;
        }
      } else {
        drawer.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
        if (unmount) {
          unmount();
          unmount = null;
          mounted = false;
        }
      }
    });
  }

  private wireKeyboard(): void {
    document.addEventListener('keydown', (ev) => {
      if (ev.key === '?' && !ev.metaKey && !ev.ctrlKey) {
        const target = ev.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        openModal('tmpl-how');
      }
      if ((ev.key === 's' || ev.key === 'S') && (ev.metaKey || ev.ctrlKey)) {
        if (this.lastResult) {
          ev.preventDefault();
          this.downloadResult();
        }
      }
    });
  }

  private mountEmpty(): void {
    this.lastResult = null;
    this.currentFile = null;
    renderEmpty(this.workbench, {
      onFile: (file) => this.handleFile(file),
      onReject: (reason) => {
        toast(reason);
        logEmit('ui', 'warn', `rejected file: ${reason}`);
      },
    });
  }

  private async ensureWorker(): Promise<Remote<WorkerApi>> {
    if (this.workerApi) return this.workerApi;
    logEmit('system', 'info', 'spawning inference worker');
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    const api = Comlink.wrap<WorkerApi>(worker);
    await api.subscribe(Comlink.proxy((e: ProgressEvent) => this.onProgress(e)));
    this.workerApi = api;
    return api;
  }

  private onProgress(e: ProgressEvent): void {
    if (this.progressView) {
      this.progressView.setStage(STAGE_LABEL[e.stage] ?? e.stage);
      this.progressView.setBar(e.fraction);
      const sub = buildSubLine(e);
      this.progressView.setSubLine(sub);
    }
    const level = e.stage === 'error' ? 'err' : 'info';
    const cat =
      e.stage === 'loading-model'
        ? 'model'
        : e.stage === 'inferring'
          ? 'infer'
          : e.stage === 'decoding' || e.stage === 'compositing'
            ? 'io'
            : 'system';
    logEmit(cat, level, `${e.stage}${e.label ? `: ${e.label}` : ''}`, eventMeta(e));
  }

  private async handleFile(file: File): Promise<void> {
    if (this.busy) {
      toast('Already processing — please wait');
      return;
    }
    this.busy = true;
    this.currentFile = file;
    logEmit('io', 'info', `loaded file`, {
      name: file.name,
      type: file.type || 'unknown',
      size: formatBytes(file.size),
    });

    this.progressView = renderProgress(this.workbench, file.name, file.size);
    this.progressView.setStage('preparing model');
    this.progressView.setBar(undefined);
    this.progressView.setSubLine('Spinning up the inference worker…');

    try {
      const api = await this.ensureWorker();
      const result = await api.process(file);
      this.lastResult = result;
      logEmit('infer', 'ok', `cutout complete`, {
        infer_ms: Math.round(result.inferMs),
        total_ms: Math.round(result.totalMs),
        device: result.device,
        out_size: formatBytes(result.pngBlob.size),
      });
      this.progressView?.destroy();
      this.progressView = null;
      this.showResult(result, file);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      logEmit('system', 'err', `processing failed: ${msg}`);
      this.progressView?.setStage('error');
      this.progressView?.setSubLine(msg);
      this.showError(msg);
    } finally {
      this.busy = false;
    }
  }

  private showResult(result: ProcessResult, file: File): void {
    renderResult(this.workbench, result, file.name, {
      onReset: () => this.mountEmpty(),
      onDownload: () => this.downloadResult(),
      onCopy: () => this.copyResult(),
      onShare: () => this.shareResult(),
    });
  }

  private showError(msg: string): void {
    const wrap = document.createElement('div');
    wrap.className = 'error-panel';
    wrap.innerHTML = `
      <h2>Something went wrong</h2>
      <p class="error-msg"></p>
      <div class="error-actions">
        <button type="button" class="btn primary" id="err-retry">Try again</button>
      </div>
    `;
    (wrap.querySelector('.error-msg') as HTMLElement).textContent = msg;
    this.workbench.appendChild(wrap);
    (wrap.querySelector('#err-retry') as HTMLButtonElement).addEventListener('click', () => {
      this.mountEmpty();
    });
  }

  private downloadResult(): void {
    if (!this.lastResult || !this.currentFile) return;
    const url = URL.createObjectURL(this.lastResult.pngBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedOutputName(this.currentFile.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    logEmit('output', 'ok', 'download triggered', { name: a.download });
    toast('Saving PNG…');
  }

  private async copyResult(): Promise<void> {
    if (!this.lastResult) return;
    try {
      type ClipNav = Navigator & {
        clipboard?: {
          write?: (items: ClipboardItem[]) => Promise<void>;
        };
      };
      const clip = (navigator as ClipNav).clipboard;
      if (!clip || typeof clip.write !== 'function' || typeof ClipboardItem === 'undefined') {
        throw new Error('Clipboard image write not supported in this browser');
      }
      await clip.write([new ClipboardItem({ [this.lastResult.pngBlob.type]: this.lastResult.pngBlob })]);
      logEmit('output', 'ok', 'copied PNG to clipboard');
      toast('Copied to clipboard');
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      logEmit('output', 'err', `clipboard write failed: ${msg}`);
      toast(`Copy failed: ${msg}`);
    }
  }

  private async shareResult(): Promise<void> {
    if (!this.lastResult || !this.currentFile) return;
    const file = new File(
      [this.lastResult.pngBlob],
      suggestedOutputName(this.currentFile.name),
      { type: 'image/png' },
    );
    try {
      type ShareNav = Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      const nav = navigator as ShareNav;
      const data: ShareData = { files: [file], title: 'Cutout from bgwipe' };
      if (!nav.canShare || !nav.canShare(data) || !nav.share) {
        throw new Error('Sharing files not supported here');
      }
      await nav.share(data);
      logEmit('output', 'ok', 'shared via system share sheet');
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (!/abort/i.test(msg)) {
        toast(`Share failed: ${msg}`);
        logEmit('output', 'err', `share failed: ${msg}`);
      }
    }
  }
}

function buildSubLine(e: ProgressEvent): string {
  if (e.stage === 'loading-model') {
    if (e.bytesLoaded != null && e.bytesTotal != null) {
      return `${formatBytes(e.bytesLoaded)} of ${formatBytes(e.bytesTotal)} · ${formatPercent((e.bytesLoaded ?? 0) / (e.bytesTotal || 1))}`;
    }
    if (e.fraction != null) return `${formatPercent(e.fraction)} · ${e.label ?? ''}`;
    return e.label ?? 'Downloading model (~168 MB, one time only)';
  }
  if (e.stage === 'decoding') return e.label ?? 'Decoding image';
  if (e.stage === 'inferring') return e.label ?? 'Running the segmentation model';
  if (e.stage === 'compositing') return e.label ?? 'Compositing the result';
  if (e.stage === 'done') return 'Done';
  return e.label ?? '';
}

function eventMeta(e: ProgressEvent): Record<string, string | number> | undefined {
  const meta: Record<string, string | number> = {};
  if (e.fraction != null) meta.pct = formatPercent(e.fraction);
  if (e.bytesLoaded != null) meta.loaded = formatBytes(e.bytesLoaded);
  if (e.bytesTotal != null) meta.total = formatBytes(e.bytesTotal);
  if (e.elapsedMs != null) meta.ms = Math.round(e.elapsedMs);
  return Object.keys(meta).length ? meta : undefined;
}

new App().start();
