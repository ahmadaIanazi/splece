# Splece — FLOW / SPARK

Approved direction: FLOW / SPARK. The final mark retains the two rounded flowing forms and sculpts the AI spark into the lower form's inner tip. The spark is part of the silhouette, not a separate ornament.

## Assets

The production files live in `public/brand/`:

- `splece-mark-{blue,white,black}.svg` — transparent vector symbol.
- `splece-wordmark-{blue,white,black}.svg` — original outlined lettering, no font dependency.
- `splece-logo-{blue,white,black}.svg` — horizontal symbol + wordmark. The white version uses a blue symbol with white lettering for dark surfaces. Blue/black versions are single-color.
- Matching transparent PNG symbols (2048 px) and horizontal logos (2800 px).
- `splece-app.svg` and `splece-app.png` — standard app tile.
- `splece-app-macos.svg` and `Splece.icns` — macOS icon with native outer padding.
- `Splece.ico` — Windows icon with 16, 24, 32, 48, 64, 128 and 256 px frames.
- `app-*.png` — small-size tile exports.
- `index.html` — presentation and download sheet at `/brand/index.html`.

`public/splece.svg` is the app-wide icon and favicon, using slightly simplified inner geometry. All existing app references receive the new identity. The welcome-page header/footer use the outlined horizontal logo. Future Mac and Windows package builds use the new icons. Previously built installers and already installed app bundles are not modified.

## Use

Primary blue: **#0866FF**. Dark canvas: **#090A0D**. Reverse: **#FFFFFF**.

Preserve the aspect ratio and both flowing forms. Keep clear space of at least one quarter of the symbol width. Use the icon alone below 120 px horizontal-logo width. Use the small-size icon below 48 px. Do not apply gradients, glow, outlines, or rotate the mark. Use a single-color version when the primary blue lacks contrast with a background.

## Rebuild

From the project root:

```
node scripts/brand/generate.mjs
swift scripts/brand/export.swift public/brand public/brand
node scripts/brand/windows-icon.mjs
swift macos/RenderIcon.swift design/brand/Splece.iconset
iconutil -c icns design/brand/Splece.iconset -o public/brand/Splece.icns
```

SVG/Swift geometry is generated from the same editable master in `scripts/brand/generate.mjs`. Raster exports require macOS; generated deliverables are included so Windows builds do not need Swift. The final production vector artwork was manually constructed from the selected concept, not raster traced or image-generated.
