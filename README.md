# MedAvatar Studio

AI-powered medical explainer video pipeline for **digital doctors + PPT/slides + medical animations + narration + Remotion**.

> Audio is the master clock, avatar providers are actors, and Remotion is the director.

## Pipeline

```text
script.md
   ↓
scene.json
   ↓
ElevenLabs / Mock TTS + timing
   ↓
HeyGen Digital Twin / Mock presenter
   ↓
PPTX → PDF → PNG + medical animation
   ↓
Remotion
   ↓
final.mp4
```

## Implemented

- `script.md -> scene.json`
- Markdown scene directives for explicit scene type, slide page, avatar position and medical animation
- Markdown headings are treated as structure and are not spoken
- scene-level timing driven by ElevenLabs character alignment
- real ElevenLabs timestamped TTS adapter
- real HeyGen v3 asset upload → avatar render → polling → transparent WebM download
- provider selection from `project.json` with optional `.env` override
- cache keys for voice, avatar and PPT stages to avoid repeated paid generations
- stale-output cleanup when switching providers or removing a PPT
- PPTX → PDF → PNG conversion through LibreOffice + `pdftoppm`
- Remotion playback of narration, transparent avatar WebM and actual slide PNGs
- presenter layouts: fullscreen / bottom-right / bottom-left / hidden
- medical animation component placeholder
- 1920×1080 / 25 fps demo project
- CI typecheck plus a free Mock storyboard/voice smoke test

## Quick start: free mock mode

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm demo
```

Mock mode does not call ElevenLabs or HeyGen. If `projects/demo/slides.pptx` is absent, the renderer uses slide placeholders.

## Script scene directives

The first Markdown heading is useful as document structure but is not narrated. Add an HTML comment before a narration paragraph when you want explicit visual control:

```md
# 高血压为什么会伤害血管

<!-- medavatar:type=doctor_full avatar=fullscreen -->
很多高血压患者并没有明显的不舒服。

<!-- medavatar:type=doctor_ppt slide=1 avatar=bottom-right scale=0.28 -->
持续升高的血压，会让血管壁长期承受更大的机械压力。

<!-- medavatar:type=medical_animation avatar=bottom-right animation=artery-pressure keywords=血管内皮,血压,压力 -->
时间一长，血管内皮更容易受损。
```

Supported directive fields:

| Field | Values / example |
| --- | --- |
| `type` | `doctor_full`, `doctor_ppt`, `medical_animation`, `visual_full` |
| `slide` | `slide=2` |
| `avatar` | `fullscreen`, `bottom-right`, `bottom-left`, `hidden` |
| `scale` | `scale=0.28` |
| `animation` | `animation=artery-pressure` |
| `keywords` | `keywords=血管内皮,血压,压力` |
| `duration` | optional estimate override such as `duration=8` |

When no directive is supplied, the MVP still generates a reasonable default scene sequence. Real TTS timing later replaces the estimated scene duration.

## Real ElevenLabs + HeyGen

Edit `projects/demo/project.json`:

```json
{
  "voice": {"provider": "elevenlabs"},
  "avatar": {"provider": "heygen"}
}
```

Then fill `.env`:

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
HEYGEN_API_KEY=...
HEYGEN_AVATAR_ID=...
```

Run:

```bash
pnpm medavatar build demo
```

HeyGen uses `POST /v3/assets` to upload the narration directly, then `POST /v3/videos` with `audio_asset_id` and `output_format=webm`. No public audio hosting is required. The selected HeyGen avatar must support matting for transparent WebM output.

## PPT support

Place a deck at:

```text
projects/demo/slides.pptx
```

Install LibreOffice and Poppler (`pdftoppm`) locally, or set:

```bash
LIBREOFFICE_BIN=/path/to/soffice
PDFTOPPM_BIN=/path/to/pdftoppm
```

Run only the slide stage:

```bash
pnpm medavatar slides demo
```

Generated slide PNGs live under `projects/demo/output/slides/` and are copied to `public/generated/` only for Remotion rendering.

## CLI

```bash
pnpm medavatar storyboard demo
pnpm medavatar voice demo
pnpm medavatar avatar demo
pnpm medavatar slides demo
pnpm medavatar render demo
pnpm medavatar build demo
```

Expected real-mode output:

```text
projects/demo/output/
├── scene.json
├── timing.json
├── narration.mp3
├── avatar.webm
├── slides/
│   ├── 001.png
│   └── 002.png
├── render-props.json
├── .cache.json
└── final.mp4
```

## Important MVP constraints

- one continuous HeyGen avatar video is generated for the narration, then Remotion changes its layout across scenes; this avoids avatar gesture resets at every sentence
- PPT native animations are not reproduced; static slide pages are animated/composited by Remotion
- medical mechanism animations are deterministic React/SVG components, not generative clinical imagery
- HeyGen direct asset upload currently has a 32 MB limit in this implementation; long videos should later be split by chapter or use HeyGen's large-file upload flow

## Next

1. chapter-aware avatar generation for long videos
2. richer subtitle segmentation and keyword highlighting
3. reusable reviewed medical animation library
4. PPT page/scene editor
5. Web UI after the CLI pipeline is stable

## Medical publishing guardrails

Human review should remain in the publishing workflow for clinical claims, medication information, references, patient privacy, doctor/avatar authorization and AI-generated-avatar disclosure.
