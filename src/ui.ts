/**
 * DOM helpers, modal manager, drop zone, before/after slider, action bar.
 *
 * No business logic — all state transitions are driven by main.ts.
 */

import { formatBytes, formatMs, isSupportedImage, suggestedOutputName } from './format';
import { emit as logEmit } from './eventlog';
import type { ProcessResult } from './types';

// ---------- toast ----------

let toastEl: HTMLElement | null = null;
let toastTimer: number | null = null;

export function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('visible'), 2400);
}

// ---------- modals ----------

let openModalCleanup: (() => void) | null = null;

export function wireModalTriggers(): void {
  document.body.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const trigger = target.closest('[data-modal]') as HTMLElement | null;
    if (!trigger) return;
    ev.preventDefault();
    const tmplId = trigger.dataset.modal;
    if (!tmplId) return;
    openModal(tmplId);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && openModalCleanup) {
      openModalCleanup();
    }
  });
}

export function openModal(templateId: string): void {
  if (openModalCleanup) openModalCleanup();

  const tmpl = document.getElementById(templateId) as HTMLTemplateElement | null;
  if (!tmpl) {
    console.warn(`modal template not found: ${templateId}`);
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');

  const content = tmpl.content.cloneNode(true) as DocumentFragment;
  const wrapper = document.createElement('div');
  wrapper.className = 'modal-wrap';
  wrapper.appendChild(content);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  wrapper.querySelector('.modal-content')?.prepend(closeBtn);

  backdrop.appendChild(wrapper);
  document.body.appendChild(backdrop);

  const cleanup = () => {
    backdrop.remove();
    openModalCleanup = null;
    logEmit('ui', 'info', `modal closed: ${templateId}`);
  };

  closeBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) cleanup();
  });
  openModalCleanup = cleanup;
  logEmit('ui', 'info', `modal opened: ${templateId}`);
}

// ---------- drop zone ----------

export interface DropZoneHandlers {
  onFile: (file: File) => void;
  onReject: (reason: string) => void;
}

export function renderDropZone(container: HTMLElement, handlers: DropZoneHandlers): void {
  container.innerHTML = '';
  const zone = document.createElement('div');
  zone.className = 'dropzone';
  zone.setAttribute('role', 'region');
  zone.setAttribute('aria-label', 'Drop image here');
  zone.innerHTML = `
    <div class="dropzone-inner">
      <svg class="dropzone-icon" viewBox="0 0 64 64" aria-hidden="true">
        <rect x="6" y="6" width="52" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 4"/>
        <path d="M32 18 L32 42 M22 32 L32 42 L42 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="dropzone-title">Drop an image here</div>
      <div class="dropzone-sub">
        or <button type="button" class="link-btn" id="dz-pick">choose a file</button>
        · or paste with <kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd>
      </div>
      <div class="dropzone-formats">JPEG · PNG · WebP — works best on photos with a clear subject</div>
    </div>
    <input type="file" accept="image/jpeg,image/png,image/webp,image/bmp" hidden id="dz-input" />
  `;
  container.appendChild(zone);

  const input = zone.querySelector('#dz-input') as HTMLInputElement;
  const pickBtn = zone.querySelector('#dz-pick') as HTMLButtonElement;

  pickBtn.addEventListener('click', () => input.click());
  zone.addEventListener('click', (ev) => {
    if (ev.target === zone || (ev.target as HTMLElement).closest('.dropzone-inner') === zone.firstElementChild) {
      input.click();
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) {
      handleFile(file, handlers);
      input.value = '';
    }
  });

  zone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    zone.classList.remove('drag-over');
    const file = ev.dataTransfer?.files?.[0];
    if (file) handleFile(file, handlers);
  });

  // Paste support
  const pasteHandler = (ev: ClipboardEvent) => {
    if (openModalCleanup) return; // ignore paste while modal open
    const items = ev.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          ev.preventDefault();
          handleFile(file, handlers);
          return;
        }
      }
    }
  };
  document.addEventListener('paste', pasteHandler);
}

function handleFile(file: File, handlers: DropZoneHandlers): void {
  if (!isSupportedImage(file)) {
    handlers.onReject(`Unsupported file type: ${file.type || 'unknown'}`);
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    handlers.onReject(`File too large (${formatBytes(file.size)}). Maximum is 30 MB.`);
    return;
  }
  handlers.onFile(file);
}

// ---------- progress view ----------

export interface ProgressView {
  setStage(label: string): void;
  setBar(fraction: number | undefined): void;
  setSubLine(line: string): void;
  destroy(): void;
}

export function renderProgress(container: HTMLElement, fileName: string, fileSize: number): ProgressView {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'progress-panel';
  wrap.innerHTML = `
    <div class="progress-head">
      <div class="progress-file">
        <span class="progress-name"></span>
        <span class="progress-size"></span>
      </div>
      <div class="progress-stage" id="pp-stage">starting…</div>
    </div>
    <div class="progress-bar"><div class="progress-fill" id="pp-fill"></div></div>
    <div class="progress-sub" id="pp-sub">&nbsp;</div>
  `;
  container.appendChild(wrap);

  (wrap.querySelector('.progress-name') as HTMLElement).textContent = fileName;
  (wrap.querySelector('.progress-size') as HTMLElement).textContent = formatBytes(fileSize);

  const stageEl = wrap.querySelector('#pp-stage') as HTMLElement;
  const fillEl = wrap.querySelector('#pp-fill') as HTMLElement;
  const subEl = wrap.querySelector('#pp-sub') as HTMLElement;

  return {
    setStage(label) {
      stageEl.textContent = label;
    },
    setBar(fraction) {
      if (fraction == null || !Number.isFinite(fraction)) {
        fillEl.classList.add('indeterminate');
        fillEl.style.width = '40%';
      } else {
        fillEl.classList.remove('indeterminate');
        const pct = Math.max(0, Math.min(1, fraction)) * 100;
        fillEl.style.width = `${pct.toFixed(1)}%`;
      }
    },
    setSubLine(line) {
      subEl.textContent = line || ' ';
    },
    destroy() {
      wrap.remove();
    },
  };
}

// ---------- result view (before/after) ----------

export interface ResultViewHandlers {
  onReset: () => void;
  onDownload: () => void;
  onCopy: () => Promise<void>;
  onShare: () => Promise<void>;
}

export function renderResult(
  container: HTMLElement,
  result: ProcessResult,
  inputName: string,
  handlers: ResultViewHandlers,
): void {
  container.innerHTML = '';

  const originalUrl = URL.createObjectURL(result.originalPngBlob);
  const cutoutUrl = URL.createObjectURL(result.pngBlob);
  const outputName = suggestedOutputName(inputName);

  const wrap = document.createElement('div');
  wrap.className = 'result-panel';

  wrap.innerHTML = `
    <div class="result-toolbar">
      <div class="result-stats">
        <span class="stat"><strong>${result.width}</strong>×<strong>${result.height}</strong></span>
        <span class="stat"><span class="stat-key">inference</span> ${formatMs(result.inferMs)}</span>
        <span class="stat"><span class="stat-key">total</span> ${formatMs(result.totalMs)}</span>
        <span class="stat"><span class="stat-key">backend</span> ${result.device}</span>
      </div>
      <button type="button" class="btn ghost" id="r-reset">↺ start over</button>
    </div>

    <div class="result-stage" id="r-stage">
      <div class="result-image-wrap" id="r-image-wrap">
        <img class="result-img result-img-bg" id="r-img-bg" alt="Original" src="${originalUrl}" />
        <img class="result-img result-img-fg" id="r-img-fg" alt="Cutout" src="${cutoutUrl}" />
        <div class="slider-handle" id="r-slider-handle">
          <div class="slider-line"></div>
          <div class="slider-knob">⇆</div>
        </div>
        <input type="range" min="0" max="100" value="50" class="slider-input" id="r-slider"
               aria-label="Before / after slider" />
      </div>
      <div class="result-tabs" id="r-tabs">
        <button type="button" class="tab on" data-view="cutout">Cutout</button>
        <button type="button" class="tab" data-view="original">Original</button>
        <button type="button" class="tab" data-view="compare">Compare</button>
      </div>
    </div>

    <div class="result-actions">
      <button type="button" class="btn primary" id="r-download">
        <span class="btn-icon">↓</span>
        Download PNG
      </button>
      <button type="button" class="btn" id="r-copy">
        <span class="btn-icon">⧉</span>
        Copy to clipboard
      </button>
      <button type="button" class="btn" id="r-share" hidden>
        <span class="btn-icon">↗</span>
        Share
      </button>
    </div>

    <p class="result-footnote">
      Saved as <code>${outputName}</code>. The PNG has a transparent background, ready to drop into any editor.
    </p>
  `;

  container.appendChild(wrap);

  // Slider behaviour
  const slider = wrap.querySelector('#r-slider') as HTMLInputElement;
  const fg = wrap.querySelector('#r-img-fg') as HTMLImageElement;
  const handle = wrap.querySelector('#r-slider-handle') as HTMLElement;
  const stage = wrap.querySelector('#r-stage') as HTMLElement;
  const tabs = wrap.querySelectorAll('#r-tabs .tab');

  const setSplit = (pct: number) => {
    fg.style.clipPath = `inset(0 0 0 ${pct}%)`;
    handle.style.left = `${pct}%`;
  };

  slider.addEventListener('input', () => setSplit(Number(slider.value)));

  const applyView = (view: string) => {
    tabs.forEach((t) => t.classList.toggle('on', (t as HTMLElement).dataset.view === view));
    stage.dataset.view = view;
    if (view === 'compare') {
      setSplit(Number(slider.value));
    } else if (view === 'cutout') {
      fg.style.clipPath = 'inset(0 0 0 0)';
      handle.style.left = '0%';
    } else {
      fg.style.clipPath = 'inset(0 0 0 100%)';
      handle.style.left = '100%';
    }
  };
  tabs.forEach((t) => {
    t.addEventListener('click', () => applyView((t as HTMLElement).dataset.view ?? 'cutout'));
  });

  // Default to cutout (the result is the hero)
  applyView('cutout');

  // Actions
  const downloadBtn = wrap.querySelector('#r-download') as HTMLButtonElement;
  const copyBtn = wrap.querySelector('#r-copy') as HTMLButtonElement;
  const shareBtn = wrap.querySelector('#r-share') as HTMLButtonElement;
  const resetBtn = wrap.querySelector('#r-reset') as HTMLButtonElement;

  downloadBtn.addEventListener('click', () => handlers.onDownload());
  copyBtn.addEventListener('click', async () => {
    copyBtn.disabled = true;
    try {
      await handlers.onCopy();
    } finally {
      copyBtn.disabled = false;
    }
  });
  resetBtn.addEventListener('click', () => {
    URL.revokeObjectURL(originalUrl);
    URL.revokeObjectURL(cutoutUrl);
    handlers.onReset();
  });

  // Web Share support
  type ShareNavigator = Navigator & { canShare?: (data: ShareData) => boolean };
  const nav = navigator as ShareNavigator;
  const shareSupported =
    typeof nav.share === 'function' &&
    typeof nav.canShare === 'function';
  if (shareSupported) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      shareBtn.disabled = true;
      try {
        await handlers.onShare();
      } finally {
        shareBtn.disabled = false;
      }
    });
  }
}

// ---------- empty state with primer ----------

export function renderEmpty(container: HTMLElement, handlers: DropZoneHandlers): void {
  container.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-stage';
  container.appendChild(empty);
  renderDropZone(empty, handlers);

  const primer = document.createElement('div');
  primer.className = 'primer';
  primer.innerHTML = `
    <div class="primer-card">
      <div class="primer-num">01</div>
      <div class="primer-title">Drop a photo</div>
      <div class="primer-body">JPEG, PNG, or WebP. Up to 30&nbsp;MB.</div>
    </div>
    <div class="primer-card">
      <div class="primer-num">02</div>
      <div class="primer-title">Stays on your device</div>
      <div class="primer-body">The model runs in this browser tab. Nothing is uploaded.</div>
    </div>
    <div class="primer-card">
      <div class="primer-num">03</div>
      <div class="primer-title">Get a transparent PNG</div>
      <div class="primer-body">Download, copy to clipboard, or share. No watermark.</div>
    </div>
  `;
  container.appendChild(primer);
}
