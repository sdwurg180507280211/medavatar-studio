# MedAvatar Studio

AI-powered medical explainer video pipeline for **digital doctors + PPT/slides + medical animations + narration + Remotion**.

> Audio is the master clock, HeyGen is the actor, and Remotion is the director.

## Pipeline

```text
script.md + optional storyboard.overrides.json
   ↓
scene.json
   ├── id          stable scene identity for editing
   ├── title       visual title, not narrated
   └── text        narration
   ↓
ElevenLabs / Mock TTS
   ├── narration.mp3 / narration.wav
   ├── alignment.json
   ├── timing.json
   └── captions.json
   ↓
HeyGen Digital Twin / Mock presenter
   ├── fixed 9:16 portrait avatar.webm
   └── optional chaptered portrait WebMs
   ↓
PPTX → PDF → PNG + deterministic medical animations
   ↓
Remotion
   ├── hero: portrait doctor as the main visual + animated title above
   ├── bottom-left/right: circular masked PiP
   └── hidden: visual-only scene
   ↓
final.mp4
```

## Core presentation model

The Digital Twin base is portrait, so MedAvatar treats **9:16 as the source and default output format**. HeyGen always renders portrait footage, and Remotion composes the final video on the same 1080×1920 canvas. A landscape project remains possible by setting explicit `video.width` and `video.height` values in `project.json`.

HeyGen WebM output is requested as the transparent-avatar source. When the selected Avatar supports matting, HeyGen marks the VP9 WebM with Alpha and Remotion must pass `transparent` to `OffthreadVideo` so the Alpha survives frame extraction. For PPT and medical-animation scenes, the transparent portrait video is then displayed through a circular Remotion mask using `overflow: hidden` and `object-fit: cover`.

For a doctor-led scene, the portrait video becomes the main `hero` visual. The scene title animates above it with a presentation-style entrance instead of placing narration in a mechanical left/right split.

## Implemented

- `script.md -> scene.json` storyboard pipeline
- optional stable `id=` directives for editor-safe scene identity
- optional `storyboard.overrides.json` visual override layer keyed by stable scene ID
- local three-panel Editor with live Draft → Resolve → Preview and explicit Save / Reset
- Inspector controls for scene type, slide or medical-animation source, subtitle style, avatar layout and circular PiP scale
- Markdown headings become visual `scene.title` values and are never sent to TTS
- narration remains in `scene.text`
- explicit `hero` presenter layout; legacy `fullscreen` is accepted as a `hero` alias
- fixed HeyGen `9:16` portrait source format
- real ElevenLabs timestamped TTS
- character alignment → scene timing → short timed captions
- karaoke active-character highlighting and keyword emphasis
- subtitle visual presets: `medical`, `minimal`, `social`
- scene boundaries preserve ElevenLabs paragraph pauses and initial lead-in
- real HeyGen v3 asset upload → Digital Twin render → polling → WebM download
- `bottom-right` / `bottom-left` circular video masks without rewriting the source video
- safe default `single` avatar strategy
- optional `chaptered` HeyGen strategy for longer videos
- scene-aware chapter planning and transition masking
- per-stage and per-chapter cache keys
- PPTX → PDF → PNG through LibreOffice + Poppler
- deterministic medical animation components
- 1080×1920 / 25fps demo
- CI typecheck + free Mock storyboard/voice/timing/caption/chapter smoke test

## Quick start

Requirements for the lightweight pipeline check: Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
TTS_PROVIDER=mock pnpm medavatar voice demo
```

That command is free and does not require ElevenLabs, HeyGen, LibreOffice or a browser.

For a complete local MP4 render, install LibreOffice + Poppler for the included `projects/demo/slides.pptx`, make sure Remotion can launch Chromium/Chrome, and have `ffmpeg`/`ffprobe` available when using a real HeyGen avatar:

```bash
TTS_PROVIDER=mock AVATAR_PROVIDER=mock pnpm demo
```

Portrait rendering defaults to a Chromium concurrency of `4` for predictable memory use. Override it for a faster or more conservative local render with `REMOTION_CONCURRENCY=2` or `REMOTION_CONCURRENCY=8`.

## Script scene directives

A Markdown heading is attached to the next narration scene as its visual title. Give scenes explicit IDs when they will be edited later:

```md
# 高血压为什么会伤害血管

<!-- medavatar:id=intro type=doctor_full avatar=hero subtitle=karaoke subtitle_style=medical -->
很多高血压患者并没有明显的不舒服。

<!-- medavatar:id=vessel-pressure type=doctor_ppt slide=1 avatar=bottom-right scale=0.28 subtitle_style=minimal keywords=血压,血管 -->
持续升高的血压，会让血管壁长期承受更大的机械压力。

## 家庭血压管理

<!-- medavatar:id=home-monitoring type=doctor_full avatar=hero -->
如果已经发现血压升高，建议记录家庭血压。
```

The headings above are visual metadata only. ElevenLabs receives only the narration paragraphs. Scene IDs accept letters, numbers, underscores and hyphens. IDs must be unique. When `id=` is omitted, the legacy `scene-001` style fallback is still generated.

Supported directive fields:

| Field | Values / example |
| --- | --- |
| `id` | stable scene identity, e.g. `id=vessel-pressure` |
| `type` | `doctor_full`, `doctor_ppt`, `medical_animation`, `visual_full` |
| `slide` | `slide=2` |
| `avatar` | `hero`, `bottom-right`, `bottom-left`, `hidden`; `fullscreen` remains a legacy alias for `hero` |
| `scale` | `scale=0.28` for circular PiP size |
| `subtitle` | `karaoke`, `sentence`, `off` |
| `subtitle_style` | `medical`, `minimal`, `social` |
| `animation` | `artery-pressure`, `plaque-growth`, `heart-beat`, `risk-pathway` |
| `keywords` | `keywords=血管内皮,血压,压力` |
| `duration` | optional estimate override, e.g. `duration=8` |

## Storyboard visual overrides

Do not hand-edit `output/scene.json`; it is generated and may be replaced whenever the storyboard stage runs. Put durable visual edits in `projects/<project>/storyboard.overrides.json` instead. The file is keyed by stable scene ID and is merged after `script.md` is parsed.

```json
{
  "version": "1.0",
  "scenes": {
    "vessel-pressure": {
      "avatar": {
        "layout": "bottom-left",
        "scale": 0.32
      },
      "subtitle": {
        "style": "minimal"
      }
    }
  }
}
```

The override layer can change scene type/title, slide, avatar layout/scale, subtitle mode/style/keywords and animation metadata. It intentionally cannot change narration text or duration, preserving the audio-master timeline. Set `title`, `slide` or `animation` to `null` when that visual element should be removed. Overrides that reference an unknown scene ID are ignored with a warning.

## Avatar presentation

```text
avatar.webm (9:16 portrait source)
        │
        ├── doctor_full
        │     └── hero presenter
        │          ├── portrait video centered as the main visual
        │          └── animated scene title above the presenter
        │
        ├── doctor_ppt
        │     └── circular PiP in bottom-right / bottom-left
        │
        ├── medical_animation
        │     └── circular PiP in bottom-right / bottom-left
        │
        └── visual_full
              └── avatar hidden
```

`bottom-right` and `bottom-left` are presentation masks only. The underlying HeyGen file stays intact.

## Real ElevenLabs + HeyGen

Keep API keys only in `.env`:

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
HEYGEN_API_KEY=...
HEYGEN_AVATAR_ID=...
```

Run real providers through `project.json` or environment overrides:

```bash
TTS_PROVIDER=elevenlabs AVATAR_PROVIDER=heygen pnpm medavatar build demo
```

HeyGen uploads narration through `POST /v3/assets`, then creates the portrait avatar through `POST /v3/videos` with a fixed `9:16` aspect ratio.

Real HeyGen runs request `output_format: "webm"` without a `background`. When the selected Avatar supports matting, HeyGen returns a VP9 WebM with Alpha. The avatar stage checks both the API's reported output format and the downloaded file's `ALPHA_MODE` plus decoded Alpha pixels before accepting or caching it. Override the local media tools when necessary:

```bash
FFMPEG_BIN=/path/to/ffmpeg FFPROBE_BIN=/path/to/ffprobe
```

Do not add `background` to the transparent WebM request: HeyGen rejects `background` together with `output_format: "webm"`. Use an opaque `mp4` request with an explicit background only as a separate fallback mode.

## Avatar strategies

### Single — default

One continuous portrait HeyGen video is created for the complete narration. Remotion changes presentation mode across scenes without changing the source file.

```json
{
  "avatar": {
    "provider": "heygen",
    "strategy": "single"
  }
}
```

### Chaptered — optional for longer videos

Inspect chapter boundaries without spending HeyGen credits:

```bash
pnpm medavatar chapters demo
```

Then explicitly enable chapter mode:

```bash
AVATAR_PROVIDER=heygen AVATAR_STRATEGY=chaptered pnpm medavatar avatar demo
```

Chapter mode uses ffmpeg only for splitting the master narration. Override the binary when necessary:

```bash
FFMPEG_BIN=/path/to/ffmpeg
```

## Timed captions

After the voice stage, MedAvatar writes:

```text
projects/demo/output/
├── timing.json
├── alignment.json
└── captions.json
```

ElevenLabs character timestamps drive caption timing directly. Changing a heading or visual layout does not change narration text, so an unchanged real TTS result can remain cacheable.

## Medical animation library

```text
artery-pressure   sustained pressure on the vessel wall
plaque-growth     endothelial injury → lipid deposition → narrowing
heart-beat        cardiac workload / heartbeat visualization
risk-pathway      hypertension → vascular injury → target-organ risk pathway
```

## PPT support

Place a deck at:

```text
projects/demo/slides.pptx
```

Configure desktop tools when needed:

```bash
LIBREOFFICE_BIN=/path/to/soffice
PDFTOPPM_BIN=/path/to/pdftoppm
```

PowerPoint native animations are not reproduced. Slides are rendered to PNG; scene and title motion are created in Remotion.

## CLI

```bash
pnpm medavatar storyboard demo
pnpm medavatar voice demo
pnpm medavatar chapters demo
pnpm medavatar avatar demo
pnpm medavatar slides demo
pnpm medavatar render demo
pnpm medavatar build demo
pnpm medavatar editor demo
```

## Current scope

The next product layer is mainly editing and production ergonomics:

1. PPT page/scene visual editor backed by `storyboard.overrides.json`
2. title-template and motion presets
3. terminology pronunciation controls
4. larger reviewed medical-animation catalog
5. B-roll / reference-card helpers
6. Web UI and job progress display

## Medical publishing guardrails

Human review should remain in the publishing workflow for clinical claims, medication information, references, patient privacy, doctor/avatar authorization and AI-generated-avatar disclosure.
