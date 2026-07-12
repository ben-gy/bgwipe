# bgwipe

**Erase image backgrounds in your browser. Photos never leave your device.**

Live: https://bgwipe.benrichardson.dev

---

## what it is

bgwipe removes the background from a photo and gives you back a transparent PNG cutout —
running a real image-segmentation model (RMBG-1.4) **entirely in your browser**. Drop an
image, get a clean cutout. No upload, no account, no per-image quota.

Commercial background removers (Remove.bg, Canva, Cutout.pro) route your photo through a
server you don't control and charge past a small free tier. For product mock-ups, identity
headshots and personal photos, that's both a privacy problem and a recurring cost. bgwipe
does the same class of work locally: the model weights are fetched once from a CDN and
cached, after which the tool works fully offline and the image never touches a network.

## how it works

1. You drop, paste, or pick an image (JPEG / PNG / WebP).
2. On first run only, a Web Worker fetches the ~168 MB RMBG-1.4 ONNX model from
   huggingface.co and caches it via the browser Cache API.
3. The worker decodes the image, runs the model to produce a single-channel alpha mask,
   resizes the mask to the original resolution, and composites it as the alpha channel of
   a fresh PNG.
4. The result is shown side-by-side with the original; you download it, copy it to the
   clipboard, or share it.

Inference uses **WebGPU** when available (~1–2 s per image) and falls back to the WASM
(CPU) ONNX runtime otherwise.

## browser APIs used

- **@huggingface/transformers v3** — runs the RMBG-1.4 segmentation model in-browser.
- **WebGPU** — hardware-accelerated inference, with a WASM CPU fallback.
- **WebAssembly (ONNX Runtime)** — the fallback inference path.
- **Web Workers (ES module)** — model load + inference off the main thread.
- **OffscreenCanvas** — decode and composite inside the worker.
- **Cache API** — model weights cached after first download, enabling offline use.
- **File API + DataTransfer / Clipboard / Web Share** — input and output delivery.

## security / privacy model

**Protected**
- The uploaded image never leaves the device — inference runs in your tab.
- No cookies, fingerprinting, third-party fonts, or error reporting. The only analytics is Cloudflare Web Analytics — anonymous, cookie-less page-view counts; no personal data, no cross-site tracking.
- No account, no API key, no rate limiter.

**Not protected**
- On *first use only*, the browser downloads the ~168 MB model weights from huggingface.co,
  so Hugging Face's CDN learns that someone at your IP fetched the model. It never sees the
  image. After that, the model is cached and the tool runs fully offline.
- GitHub Pages / Cloudflare log the initial page load like any website visit.

**Trust model**
- The static site bundle, deployed by the GitHub Action and pinned to its commit.
- The TLS chain to `bgwipe.benrichardson.dev`.
- The RMBG-1.4 model weights fetched once from huggingface.co.
- The open-source, MIT-licensed transformers.js runtime.

## stack

- Vite 6 + vanilla TypeScript
- `@huggingface/transformers` for in-browser ML, `comlink` for worker RPC
- Vitest for unit tests
- GitHub Pages for hosting, deployed via GitHub Actions

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via Cloudflare Web Analytics — no personal data, no cross-site tracking.

## local development

```bash
npm install
npm run dev      # vite dev server on :5173
npm test         # run the vitest suite
npm run build    # produce dist/ for deploy
npm run preview  # serve dist/ locally
```

## deploying

A push to `main` triggers `.github/workflows/deploy.yml`, which runs the tests, builds, and
deploys `dist/` to GitHub Pages. The custom domain is set via `public/CNAME` — point a CNAME
DNS record for `bgwipe.benrichardson.dev` at `ben-gy.github.io`.

## license

MIT — see [LICENSE](./LICENSE).
