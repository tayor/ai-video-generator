# Windows Setup

## Requirements

- Node.js **20.18+**
- `ffmpeg` and `ffprobe`
- Cloudflare Workers AI **Account ID** + **API token**
- Optional: Pexels API key

This CLI no longer needs Python, Jupyter, or ImageMagick.

## 1. Install Node.js

Download the current LTS release from:

- https://nodejs.org/

Verify:

```powershell
node --version
npm --version
```

## 2. Install ffmpeg

### Winget

```powershell
winget install Gyan.FFmpeg
```

### Scoop

```powershell
scoop install ffmpeg
```

### Chocolatey

```powershell
choco install ffmpeg
```

Verify:

```powershell
ffmpeg -version
ffprobe -version
```

## 3. Run the CLI

### NPX

```powershell
npx ai-video-generator init --profile hybrid
```

### Global install

```powershell
npm install -g ai-video-generator
ai-video-generator init --profile hybrid
```

## 4. Configure `.env`

Edit `.env` and set:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `PEXELS_API_KEY` if you want stock footage or stock images

## 5. Verify setup

```powershell
ai-video-generator doctor
ai-video-generator review-sample
```

## 6. Generate a video

```powershell
ai-video-generator generate "3 futuristic city facts"
```

## Troubleshooting

### `ffmpeg` not found

- Restart the terminal after installation.
- Confirm both `ffmpeg` and `ffprobe` are on `PATH`.

### Cloudflare auth errors

- Recheck `CLOUDFLARE_ACCOUNT_ID`
- Recheck `CLOUDFLARE_API_TOKEN`
- Make sure the token has **Workers AI Read** or **Workers AI Write**
- If generation works but review fails, run `ai-video-generator review-sample` to confirm Gemma can read extracted frames from a local sample video

### Pexels errors

- `stock-video` and `stock-image` profiles require `PEXELS_API_KEY`
- `hybrid` lets Kimi choose per cut from stock video, stock image, and AI image; without Pexels, only `ai_image` remains available
