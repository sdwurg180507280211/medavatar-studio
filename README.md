# MedAvatar Studio

AI-powered medical explainer video pipeline for **digital doctors + PPT/slides + medical animations + narration + Remotion**.

> Audio is the master clock, HeyGen is the actor, and Remotion is the director.

## Pipeline

```text
script.md
   ↓
scene.json
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

The Digital Twin base is portrait, so MedAvatar treats **9:16 as the source format**, not as an error that needs landscape compensation. HeyGen always renders portrait footage. Remotion then decides how that source appears in the 16:9 final composition.

There is no default transparent-background or person-matting step. For PPT and medical-animation scenes, the original portrait video is displayed through a circular Remotion mask using `overflow: hidden` and `object-fit: cover`.

For a doctor-led scene, the portrait video becomes the main `hero` visual. The scene title animates above it with a presentation-style entrance instead of placing narration in a mechanical left/right split.

## Implemented

- `script.md -> scene.json` storyboard pipeline
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
- 1920×1080 / 25fps demo
- CI typecheck + free Mock storyboard/voice/timing/caption/chapter smoke test

## Quick start

Requirements for the lightweight pipeline check: Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
TTS_PROVIDER=mock pnpm medavatar voice demo
```

That command is free and does not require ElevenLabs, HeyGen, LibreOffice or a browser.

For a complete local MP4 render, install LibreOffice + Poppler for the included `projects/demo/slides.pptx`, and make sure Remotion can launch Chromium/Chrome:

```bash
TTS_PROVIDER=mock AVATAR_PROVIDER=mock pnpm demo
```

## Script scene directives

A Markdown heading is attached to the next narration scene as its visual title:

```md
# 高血压为什么会伤害血管

<!-- medavatar:type=doctor_full avatar=hero subtitle=karaoke subtitle_style=medical -->
很多高血压患者并没有明显的不舒服。

<!-- medavatar:type=doctor_ppt slide=1 avatar=bottom-right scale=0.28 subtitle_style=minimal keywords=血压,血管 -->
持续升高的血压，会让血管壁长期承受更大的机械压力。

## 家庭血压管理

<!-- medavatar:type=doctor_full avatar=hero -->
如果已经发现血压升高，建议记录家庭血压。
```

The headings above are visual metadata only. ElevenLabs receives only the narration paragraphs.

Supported directive fields:

| Field | Values / example |
| --- | --- |
| `type` | `doctor_full`, `doctor_ppt`, `medical_animation`, `visual_full` |
| `slide` | `slide=2` |
| `avatar` | `hero`, `bottom-right`, `bottom-left`, `hidden`; `fullscreen` remains a legacy alias for `hero` |
| `scale` | `scale=0.28` for circular PiP size |
| `subtitle` | `karaoke`, `sentence`, `off` |
| `subtitle_style` | `medical`, `minimal`, `social` |
| `animation` | `artery-pressure`, `plaque-growth`, `heart-beat`, `risk-pathway` |
| `keywords` | `keywords=血管内皮,血压,压力` |
| `duration` | optional estimate override, e.g. `duration=8` |

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
```

## Current scope

The next product layer is mainly editing and production ergonomics:

1. PPT page/scene visual editor
2. title-template and motion presets
3. terminology pronunciation controls
4. larger reviewed medical-animation catalog
5. B-roll / reference-card helpers
6. Web UI and job progress display

## Medical publishing guardrails

Human review should remain in the publishing workflow for clinical claims, medication information, references, patient privacy, doctor/avatar authorization and AI-generated-avatar disclosure.
