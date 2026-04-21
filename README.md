# AI Video Generator CLI

TypeScript CLI for generating narrated short-form videos with **Cloudflare Workers AI**, **Pexels**, and **ffmpeg**. It is packaged for **public npm publishing**, works with **`npx`**, and supports **global install** through `npm install -g`.

## What it uses

| Purpose | Provider | Model / API |
| --- | --- | --- |
| Script + visual planning | Cloudflare Workers AI | `@cf/moonshotai/kimi-k2.6` |
| Reference-image understanding | Cloudflare Workers AI | `@cf/moonshotai/kimi-k2.6` (`image_url` message parts) |
| Render review + iteration | Cloudflare Workers AI | `@cf/google/gemma-4-26b-a4b-it` |
| Image generation fallback | Cloudflare Workers AI | `@cf/black-forest-labs/flux-1-schnell` |
| Speech-to-text | Cloudflare Workers AI | `@cf/openai/whisper` |
| Text-to-speech | Cloudflare Workers AI | `@cf/myshell-ai/melotts` |
| Stock videos / photos | Pexels | Videos API + Photos API |
| Rendering | Local binary | `ffmpeg` / `ffprobe` |

## Requirements

- Node.js **20.18+**
- `ffmpeg` and `ffprobe` on your `PATH`
- Cloudflare **Account ID** and **Workers AI API token**
- Optional: **Pexels API key** if you want stock footage or stock images

## Install

### NPX

```bash
npx ai-video-generator init --profile hybrid
```

### Global install

```bash
npm install -g ai-video-generator
ai-video-generator init --profile hybrid
```

### Local development

```bash
npm install
npm run check
```

## Onboarding profiles

Use `init --profile <profile>` to create `.env` and `.env.example`.

The profile defines the **available source pool**. **Kimi chooses the actual source for each cut/scene** from that pool.

| Profile | Needs Cloudflare | Needs Pexels | Source pool Kimi can choose from |
| --- | --- | --- | --- |
| `hybrid` | Yes | Optional | `stock_video`, `stock_image`, `ai_image` |
| `stock-video` | Yes | Yes | `stock_video` only |
| `stock-image` | Yes | Yes | `stock_image` only |
| `ai-image` | Yes | No | `ai_image` only |

After `init`, edit `.env` and then run:

```bash
ai-video-generator doctor
```

Then verify the reviewer path against a generated sample video:

```bash
ai-video-generator review-sample
```

## Usage

### Basic generation

```bash
ai-video-generator generate "5 surprising facts about volcanoes"
```

### Use reference images for Kimi K2.6 vision guidance

```bash
ai-video-generator generate "cinematic travel teaser for Iceland" \
  --reference-image ./refs/ice-1.jpg ./refs/ice-2.jpg
```

### Use an AI-image-only source pool

```bash
npx ai-video-generator init --profile ai-image
ai-video-generator generate "space startup launch trailer"
```

### Landscape output

```bash
ai-video-generator generate "history of electric cars" \
  --orientation landscape \
  --output ./out/history-of-evs.mp4
```

## Commands

### `generate`

```bash
ai-video-generator generate <prompt...> [options]
```

Options:

- `--output <path>`: output `.mp4` path or output directory
- `--orientation <portrait|landscape>`
- `--reference-image <paths...>`: local images passed to Kimi K2.6 as `image_url` content
- `--no-captions`
- `--keep-temp`

### `init`

```bash
ai-video-generator init --profile hybrid
```

Creates or refreshes:

- `.env.example`
- `.env` (unless it already exists, or you pass `--force`)

### `doctor`

```bash
ai-video-generator doctor
```

Checks:

- `ffmpeg` / `ffprobe`
- `.env` presence
- Cloudflare credentials
- Pexels requirements for the selected source profile

### `review-sample`

```bash
ai-video-generator review-sample
```

Creates a short text-only sample video, extracts review frames with ffmpeg, and checks that Gemma can read the rendered content correctly.

## Caption styles

`init` now writes a TikTok-style caption preset by default for portrait videos. That preset uses uppercase display text, automatic multi-line balancing to avoid horizontal overflow, and word-by-word highlight overlays timed from Whisper timestamps.

Set `CAPTION_STYLE=classic` if you want the older single-layer subtitle look instead. You can tune the active-word color and styling through the `CAPTION_*` keys in `.env`.

## Review loop

By default, every render goes through a Gemma review pass. If Gemma finds problems, the feedback is fed back into Kimi and the generator reruns the story + visual plan up to the configured retry limit.

Workers AI currently accepts the Gemma reviewer reliably through sampled video frames (`image_url` parts). The published model docs describe direct video/file support, but the live runtime rejected `file` parts during integration testing, so this CLI uses ffmpeg frame extraction for the review step.

## `.env` reference

Core keys:

```env
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_KIMI_MODEL=@cf/moonshotai/kimi-k2.6
CLOUDFLARE_GEMMA_REVIEW_MODEL=@cf/google/gemma-4-26b-a4b-it
CLOUDFLARE_FLUX_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_WHISPER_MODEL=@cf/openai/whisper
CLOUDFLARE_MELOTTS_MODEL=@cf/myshell-ai/melotts
VIDEO_REVIEW_ENABLED=true
VIDEO_REVIEW_MAX_ITERATIONS=1
VISUAL_SOURCE_PROFILE=hybrid
PEXELS_API_KEY=...
```

Render keys:

```env
VIDEO_ORIENTATION=portrait
VIDEO_FPS=30
CAPTIONS_ENABLED=true
CAPTION_STYLE=tiktok
CAPTION_FONT_SIZE=72
CAPTION_FONT_COLOR=white
CAPTION_HIGHLIGHT_COLOR=green
CAPTION_FONT_FACE=NanumSquareRound
CAPTION_STROKE_WIDTH=4.5
CAPTION_STROKE_COLOR=black
CAPTION_BOLD=true
CAPTION_SHADOW_DEPTH=0
CAPTION_POSITION=bottom_center
CAPTION_MAX_WORDS=6
CAPTION_MAX_CHARS=28
CAPTION_MAX_DURATION_SECONDS=4.2
```

## Output

Each run writes:

- an `.mp4` video
- a `.json` manifest next to the video with the generated script, cues, visual plan, and review history

If you pass `--keep-temp`, the ffmpeg working directory is kept for inspection.

## Publish notes

The package is configured for public npm publishing:

- package name: `ai-video-generator`
- CLI binary: `ai-video-generator`
- `publishConfig.access=public`
- `prepack` runs the TypeScript build before publishing
- license: MIT

First publish:

```bash
npm publish --access public
```

## License

MIT.

## Development

```bash
npm install
npm run build
npm test
npm run check
```
