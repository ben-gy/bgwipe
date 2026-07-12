# bgwipe — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **GitHub Pages:** https://ben-gy.github.io/bgwipe/ *(redirects to the custom domain)*
- **Custom domain:** https://bgwipe.benrichardson.dev

## What it is

Erase image backgrounds in your browser with an in-browser ML model (RMBG-1.4), accelerated
by WebGPU with a WASM fallback. Photos never leave the device; the model is fetched once and
cached for offline use.

## DNS

CNAME `bgwipe` → `ben-gy.github.io` (Cloudflare, DNS-only) — already created.
