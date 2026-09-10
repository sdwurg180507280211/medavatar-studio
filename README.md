# MedAvatar Studio

AI-powered medical explainer video pipeline for **digital doctors + PPT/slides + medical animations + narration + Remotion**.

> Audio is the master clock, avatar providers are actors, and Remotion is the director.

## Pipeline

```text
script.md
   ↓
scene.json
   ↓
ElevenLabs / Mock TTS
   ├── narration.mp3 / narration.wav
   ├── alignment.json
   ├── timing.json
   └── captions.json
   ↓
HeyGen Digital Twin / Mock presenter
   ├── single full-frame avatar.webm
   └── optional chaptered full-frame WebMs
   ↓
PPTX → PDF → PNG + deterministic medical animations
   ↓
Remotion
   ├── fullscreen: show the complete avatar video
   └── bottom-left/right: circular video viewport
   ↓
final.mp4
```

## Implemented

- `script.md -> scene.json` storyboard pipeline
- Markdown directives for scene type, PPT page, avatar position, subtitle mode/style, keywords and medical animations
- real ElevenLabs timestamped TTS
- character alignment → scene timing → short timed captions
- karaoke-style active-character highlighting and keyword emphasis
- subtitle visual presets: `medical`, `minimal`, `social`
- scene boundaries preserve ElevenLabs paragraph pauses and initial lead-in
- real HeyGen v3 asset upload → Digital Twin render → polling → full-frame WebM download
- HeyGen source video stays intact; no default MediaPipe matting or physical person crop
- fullscreen scenes display the complete avatar video
- `bottom-right` / `bottom-left` scenes show the same video through a circular Remotion viewport
- safe default `single` avatar strategy
- optional `chaptered` HeyGen strategy for longer videos
- chapter planning prefers visual/PPT/animation boundaries to hide avatar resets
- short avatar fade masking at chapter boundaries that can visually hide a pose reset
- per-stage and per-chapter cache keys to reduce repeated paid generation
- resumable chapter generation and protection against rendering a partial chapter manifest
- PPTX → PDF → PNG through LibreOffice + Poppler
- presenter layouts: fullscreen / bottom-right / bottom-left / hidden
- reusable deterministic medical animation components
- 1920×1080 / 25fps demo
- CI typecheck + free Mock voice/timing/caption/chapter-plan smoke test

## Quick start

Requirements for the lightweight pipeline check: Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
TTS_PROVIDER=mock pnpm medavatar voice demo
```

That command is free and does not require ElevenLabs, HeyGen, LibreOffice or a browser. It validates storyboard, mock narration, scene timing, alignment, captions and chapter planning.

For a complete local MP4 render, install LibreOffice + Poppler for the included `projects/demo/slides.pptx`, and make sure Remotion can launch a Chromium/Chrome runtime. Then run:

```bash
TTS_PROVIDER=mock AVATAR_PROVIDER=mock pnpm demo
```

## Script scene directives

Markdown headings are structural and are not narrated. Put a `medavatar` comment before a narration paragraph when explicit visual control is needed:

```md
# 高血压为什么会伤害血管

<!-- medavatar:type=doctor_full avatar=fullscreen subtitle=karaoke subtitle_style=medical -->
很多高血压患者并没有明显的不舒服。

<!-- medavatar:type=doctor_ppt slide=1 avatar=bottom-right scale=0.28 subtitle_style=minimal keywords=血压,血管 -->
持续升高的血压，会让血管壁长期承受更大的机械压力。

<!-- medavatar:type=medical_animation avatar=bottom-right animation=artery-pressure subtitle_style=social keywords=血管内皮,血压,压力 -->
时间一长，血管内皮更容易受损。
```

Supported directive fields:

| Field | Values / example |
| --- | --- |
| `type` | `doctor_full`, `doctor_ppt`, `medical_animation`, `visual_full` |
| `slide` | `slide=2` |
| `avatar` | `fullscreen`, `bottom-right`, `bottom-left`, `hidden` |
| `scale` | `scale=0.28` |
| `subtitle` | `karaoke`, `sentence`, `off` |
| `subtitle_style` | `medical`, `minimal`, `social` |
| `animation` | `artery-pressure`, `plaque-growth`, `heart-beat`, `risk-pathway` |
| `keywords` | `keywords=血管内皮,血压,压力` |
| `duration` | optional estimate override, e.g. `duration=8` |

For avatar presentation, `scale` controls the circular PiP diameter for `bottom-right` / `bottom-left`. The HeyGen video file itself is never physically cropped by this setting.

`keywords` are reused by subtitle highlighting and, where applicable, the medical-animation scene.

Subtitle presets are intentionally simple:

- `medical`: balanced dark translucent bar, cyan medical keywords, warm active character
- `minimal`: smaller/lighter treatment for PPT-heavy course videos
- `social`: larger high-contrast captions for short-form video

## Timed captions

After the voice stage, MedAvatar writes:

```text
projects/demo/output/
├── timing.json
├── alignment.json
└── captions.json
```

ElevenLabs character timestamps drive caption timing directly. The renderer splits long narration into short caption cues and can emphasize the currently spoken character plus configured medical keywords.

Run only this part:

```bash
pnpm medavatar voice demo
```

## Real ElevenLabs + HeyGen

Keep API keys only in `.env`:

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
HEYGEN_API_KEY=...
HEYGEN_AVATAR_ID=...
```

Use real providers through `project.json` or environment overrides:

```bash
TTS_PROVIDER=elevenlabs AVATAR_PROVIDER=heygen pnpm medavatar build demo
```

HeyGen uploads narration through `POST /v3/assets`, then creates an audio-driven avatar video through `POST /v3/videos`. MedAvatar keeps that full video frame intact. The avatar does **not** need to support transparent matting for the normal fullscreen + circular-PiP presentation.

## Avatar presentation

The same HeyGen source is reused for every visual layout:

```text
avatar.webm (full 16:9 source)
        │
        ├── doctor_full
        │     └── fullscreen / complete frame
        │
        ├── doctor_ppt
        │     └── circular PiP in bottom-right or bottom-left
        │
        └── medical_animation
              └── circular PiP in bottom-right or bottom-left
```

`bottom-right` and `bottom-left` are display masks only. Remotion uses a circular container, `overflow: hidden`, and `object-fit: cover`; it does not rewrite or crop the underlying avatar file.

The default PiP focus is centered slightly above the middle of the HeyGen frame so a talking doctor's upper body reads well in a circle. `scale=0.28` produces roughly a 360 px circle in a 1920×1080 composition.

## Avatar strategies

### Single — default

One continuous HeyGen avatar is created for the complete narration:

```json
{
  "avatar": {
    "provider": "heygen",
    "strategy": "single"
  }
}
```

This minimizes HeyGen jobs and avoids unnecessary credit usage. Remotion changes the same complete avatar video's presentation across scenes without changing the source asset.

When migrating from the brief older local-matting implementation, MedAvatar will reuse an existing `avatar-raw.webm` as the new full-frame `avatar.webm` when possible instead of calling HeyGen again.

### Chaptered — optional for longer videos

First inspect the planned boundaries without spending HeyGen credits:

```bash
pnpm medavatar chapters demo
```

Then explicitly enable chapter mode:

```json
{
  "avatar": {
    "provider": "heygen",
    "strategy": "chaptered",
    "chapterMaxSeconds": 90
  }
}
```

or temporarily:

```bash
AVATAR_PROVIDER=heygen AVATAR_STRATEGY=chaptered pnpm medavatar avatar demo
```

Chapter mode:

1. plans cuts on Scene boundaries;
2. prefers PPT / medical-animation / hidden-or-PiP boundaries;
3. splits the master narration with ffmpeg;
4. renders one full-frame HeyGen WebM per chapter;
5. caches completed chapters;
6. writes `avatar-manifest.json`;
7. places each chapter back on the global Remotion timeline while the original narration remains the only audio master;
8. briefly fades the avatar at maskable visual boundaries to reduce visible pose resets.

If chapter 2/3 fails, completed chapter files remain reusable, but a partial manifest is never accepted as a complete render source.

Chapter mode requires ffmpeg. Override the binary if necessary:

```bash
FFMPEG_BIN=/path/to/ffmpeg
```

## Medical animation library

Current deterministic React/Remotion components:

```text
artery-pressure   sustained pressure on the vessel wall
plaque-growth     endothelial injury → lipid deposition → narrowing
heart-beat        cardiac workload / heartbeat visualization
risk-pathway      hypertension → vascular injury → target-organ risk pathway
```

These are intentionally deterministic rather than generative clinical visuals, so the mechanism can be reviewed and reused consistently.

## PPT support

Place a deck at:

```text
projects/demo/slides.pptx
```

Install LibreOffice and Poppler (`pdftoppm`) or configure:

```bash
LIBREOFFICE_BIN=/path/to/soffice
PDFTOPPM_BIN=/path/to/pdftoppm
```

Run only the slide stage:

```bash
pnpm medavatar slides demo
```

PowerPoint native animations are not reproduced. Pages are rendered to PNG and then animated/composited by Remotion.

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

Typical single-avatar output:

```text
projects/demo/output/
├── scene.json
├── timing.json
├── alignment.json
├── captions.json
├── chapters.json
├── narration.mp3
├── avatar.webm
├── slides/
├── render-props.json
├── .cache.json
└── final.mp4
```

Chaptered mode additionally uses:

```text
projects/demo/output/
├── audio-chapters/
├── avatar-chapters/
└── avatar-manifest.json
```

## Current scope

The CLI pipeline is now suitable for real end-to-end iteration. The next product layer is mainly editing and production ergonomics:

1. PPT page/scene visual editor
2. terminology pronunciation controls
3. larger reviewed medical-animation component catalog
4. B-roll / reference-card helpers
5. Web UI and job progress display

## Medical publishing guardrails

Human review should remain in the publishing workflow for clinical claims, medication information, references, patient privacy, doctor/avatar authorization and AI-generated-avatar disclosure.
