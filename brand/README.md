# Brand assets

Canonical source files for the LeadAce logo and derived assets.

| File | Purpose |
|---|---|
| `logo-source.png` | Original generated art (Gemini, 512×512, terracotta on transparent) |
| `logo.svg` | Traced vector, `fill="currentColor"` — use in app code (inherits CSS color) |
| `logo-color.svg` | Same path, fill baked to `#D06A57` — use for favicons, emails, OG, anywhere CSS `color` cannot apply |
| `og.svg` / `og.png` | 1200×630 social share image (logo + wordmark + tagline) |

## Regenerating favicons

Favicons and apple-touch-icon are generated from `logo-color.svg`. To regenerate:

```bash
# From brand/
magick -background none -size 512x512 logo-color.svg favicon-512.png
magick favicon-512.png -resize 192x192 favicon-192.png
magick favicon-512.png -resize 180x180 -background '#F6EEE6' -alpha remove -alpha off apple-touch-icon.png
magick -background none -size 256x256 logo-color.svg -morphology Dilate Octagon:3 -resize 32x32 favicon-32.png
magick -background none -size 128x128 logo-color.svg -morphology Dilate Octagon:2 -resize 16x16 favicon-16.png
magick favicon-32.png favicon-16.png favicon.ico
# Then copy to frontend/static/ and landing/public/
```

Small sizes use `-morphology Dilate` before downsampling because the stroke density is too fine to render cleanly at 16–32px otherwise.

## Regenerating the OG image

`og.png` is rasterized from `og.svg`. Update the SVG (wordmark, tagline, colors), then:

```bash
# From repo root
magick -background "#F6EEE6" -density 288 brand/og.svg -resize 1200x630 brand/og.png
cp brand/og.png frontend/static/og.png
cp brand/og.png landing/public/og.png
```

`-density 288` (4× of 72dpi baseline) gives crisp text at the 1200×630 target size. The three copies are served as `og:image` from `brand/` (canonical), `app.leadace.ai/og.png`, and `leadace.ai/og.png`.

## Regenerating the trace from the source PNG

If the source art is updated:

```bash
magick logo-source.png -alpha extract -negate -resize 1024x1024 -threshold 50% logo-mask.pbm
potrace -s --flat -t 5 -a 1.334 -O 0.4 -o logo-raw.svg logo-mask.pbm
# Hand-clean logo-raw.svg → logo.svg (use fill="currentColor")
# Duplicate with sed → logo-color.svg (bake #D06A57)
```

Requires `potrace` (`brew install potrace`) and ImageMagick.

## Brand colors

| Token | Light | Dark |
|---|---|---|
| Accent | `#D06A57` | `#E0887A` |
| Warm bg | `#F6EEE6` | `#1F1A17` |
| Page bg | `#ffffff` | `#141414` |
| Text | `#333333` | `#E8E8E8` |
