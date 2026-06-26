# Tool Plan: bgwipe

## Overview
- **Name:** bgwipe
- **Repo name:** bgwipe
- **Tagline:** Erase image backgrounds in your browser. Photos never leave your device.

## Problem It Solves
A small-business seller, an Etsy lister, a freelance designer, or a social-media manager
needs a transparent-PNG cutout of a product or person. Today they upload to Remove.bg,
Canva, or Cutout.pro — services that charge per image past a free quota, throttle on
free tiers, and route the user's photo through a server they don't control. For product
photos and personal shots, that's a privacy and cost annoyance. bgwipe runs the same
class of segmentation model entirely in the browser: drop an image, get back a PNG with
a transparent background. No upload, no account, no quota.

## Why This Must Be Client-Side
- **Privacy:** product mock-ups, identity headshots, and personal photos often shouldn't
  be uploaded to a third-party SaaS. Many users have hard rules (NDA-protected product
  shots, regulated industries).
- **Cost-avoidance:** commercial bg-removal services charge $0.20–$1 per image past a
  small free quota. Offline ML costs the user nothing past the one-time model fetch.
- **No-account friction:** no signup, no API key, no rate limit. Open the page, get a
  result.
- **Offline:** once the model is cached, the tool works on a plane, on a train, in a
  poor-coverage area.

## Browser APIs / Libraries Used
| API / Library | What it does for us | Fallback if unsupported |
|---------------|---------------------|-------------------------|
| @huggingface/transformers v3 | Runs RMBG-1.4 segmentation ONNX in browser | N/A — hard requirement |
| WebGPU | Hardware-accelerated tensor ops (~1–2s per image) | Falls back to WASM (CPU, ~10–30s) |
| WebAssembly (ONNX Runtime) | Fallback inference path | N/A |
| Web Workers (ES module) | Offload model load + inference off main thread | N/A — required |
| OffscreenCanvas | Decode + composite image in the worker | Main-thread Canvas fallback |
| Cache API | transformers.js caches model weights so reruns are offline | Re-download on each load |
| File API + DataTransfer | Drag-and-drop, paste, tap-to-pick input | N/A |
| Web Share API | One-tap share of the result PNG on mobile | Download button always present |
| Clipboard API | Copy PNG to clipboard for paste into Slack/email | Download button always present |
| URL.createObjectURL | Deliver result as a download link | N/A |

## Workflow (input → process → output)
1. User drops, pastes, or picks an image (JPEG / PNG / WebP / HEIC where supported).
2. On first run only, the worker fetches the ~44MB RMBG-1.4 ONNX model from
   huggingface.co and caches it in the browser's Cache API.
3. Worker decodes the image into a tensor, runs the model, gets a single-channel
   alpha mask, resizes it to the original image's resolution, and composites it as the
   alpha channel of a fresh PNG.
4. UI shows the result side-by-side with the original (slider for before/after on
   desktop, swipe-tab on mobile).
5. User downloads the PNG, copies it to clipboard, or shares via the Web Share API.

## Non-Goals
- No batch processing in v1 (queue up one image at a time)
- No background *replacement* in v1 (output is always transparent PNG; you composite
  in your own editor)
- No video bg removal
- No editing / brush touch-ups (model output is the final mask)
- No cloud sync — ever

## Target Audience
A part-time Etsy seller photographing handmade jewellery on her kitchen table at 9pm,
needing a clean product shot for a new listing. Or a recruiter cleaning up a candidate's
headshot before adding them to a deck. Non-technical, on a laptop or phone, wants a
result in under a minute, doesn't want to upload to a stranger's server.

## Style Direction
**Tone:** friendly, calm, reassuring — *not* hacker terminal
**Colour palette:** warm off-white surface, muted slate text, a single sage-green accent
for primary actions. Soft shadows. Generous whitespace. Inspired by Linear's onboarding
and the Things 3 app — clean, never cold.
**UI density:** spacious
**Dark/light theme:** light first; respect `prefers-color-scheme: dark` as a soft dark
mode (not pitch-black, more like a warm graphite)
**Reference tools for feel:** [Squoosh](https://squoosh.app) for the before/after slider
discipline, [Things 3](https://culturedcode.com/things/) for the calm spacing

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite (no React — single workflow, no need for it)
- **Key libraries:**
  - `@huggingface/transformers` ^3.5.0 (browser ML runtime)
  - `comlink` ^4.4.2 (ergonomic worker RPC for `init`, `processImage`, `getProgress`)
- **Worker strategy:** Single dedicated ES-module worker that owns the model + processor
  and runs all inference + image preprocessing. Main thread only renders UI.
- **Storage:** None for user data. transformers.js's internal Cache API stores model
  weights. `localStorage` stores only UI preferences (e.g. dark-mode toggle).

## Privacy & Trust Model

**Protected**
- The uploaded image never leaves the device. Inference runs in your tab.
- No analytics, no cookies, no third-party fonts, no telemetry, no error reporting.
- No account, no API key, no rate limiter to bypass.

**Not protected**
- On *first use only*, the browser downloads the ~44MB RMBG-1.4 model weights from
  `huggingface.co`. Hugging Face's CDN therefore learns that someone with your IP
  fetched the model. They do not see the image. After the first download the model is
  cached and the tool works fully offline.
- GitHub Pages (and Cloudflare in front of it) log the initial HTML / JS / CSS fetch as
  any normal site visit would.

**Trust surface**
- The static site bundle (deployed by the `Deploy to GitHub Pages` GitHub Action and
  pinned via that commit hash)
- The TLS chain to `bgwipe.benrichardson.dev` (via Cloudflare DNS to ben-gy.github.io)
- The RMBG-1.4 model weights fetched once from huggingface.co
- The transformers.js runtime (open source, MIT-licensed)

## UX Required Surfaces
- Big, calm drop zone with drag, paste (Cmd/Ctrl+V), tap-to-pick
- Loading screen with **clear** "one-time 44MB model download" message and progress bar
- Determinate progress for the inference step (model emits per-stage hooks)
- Before/after slider on the result (desktop), swipe-tab fallback (mobile)
- Output actions: Download PNG · Copy to clipboard · Share (where supported)
- Event log drawer (collapsible, shows model-load + inference timings)
- How-it-works modal (5 steps)
- Threat model modal (Protected / Not Protected / Trust surface)
- About modal with benrichardson.dev attribution + source link
- Sticky footer "Built by benrichardson.dev"
- Keyboard: Escape closes modals, Cmd/Ctrl+V pastes from clipboard,
  Cmd/Ctrl+S triggers download when result is showing
