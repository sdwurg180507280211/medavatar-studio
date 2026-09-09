# MedAvatar Studio

AI-powered medical explainer video pipeline for **digital doctors + PPT/slides + medical animations + narration + Remotion**.

> MVP philosophy: audio is the master clock, avatar providers are actors, and Remotion is the director.

## MVP pipeline

```text
script.md
   ↓
scene.json
   ↓
TTS / timing
   ↓
Digital avatar
   ↓
PPT + medical animation
   ↓
Remotion
   ↓
final.mp4
```

The first committed MVP deliberately uses mock providers so the complete timeline and renderer can be developed without spending ElevenLabs/HeyGen credits.

## What works now

- `script.md -> scene.json`
- Zod scene schema
- Four scene types: `doctor_full`, `doctor_ppt`, `medical_animation`, `visual_full`
- Mock TTS generates a valid silent WAV plus timing data
- Mock doctor presenter with fullscreen / bottom-right / bottom-left / hidden layouts
- Remotion scene sequencing
- PPT-style slide placeholder
- Deterministic medical mechanism animation placeholder
- 1920×1080 / 25 fps render
- Provider boundaries for ElevenLabs and HeyGen
- Demo project

## Quick start

Requirements: Node.js 20+ and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm demo
```

Expected output:

```text
projects/demo/output/
├── scene.json
├── timing.json
├── narration.wav
├── render-props.json
└── final.mp4
```

Open Remotion Studio:

```bash
pnpm studio
```

Run individual stages:

```bash
pnpm medavatar storyboard demo
pnpm medavatar voice demo
pnpm medavatar render demo
```

## Scene contract

```json
{
  "id": "scene-002",
  "type": "doctor_ppt",
  "text": "持续升高的血压，会让血管壁承受更大的压力。",
  "durationInSeconds": 8,
  "slide": 1,
  "avatar": {
    "layout": "bottom-right",
    "scale": 0.28
  }
}
```

The renderer consumes scene JSON rather than coupling itself to HeyGen or ElevenLabs. This lets providers be replaced later without rewriting the video engine.

## Provider roadmap

### ElevenLabs

`src/providers/elevenlabs.ts` contains the real TTS adapter boundary using the timestamped speech endpoint. The CLI remains on the mock provider until provider selection and cache semantics are finalized.

### HeyGen

`src/providers/heygen.ts` contains the API boundary for audio-driven avatar generation. Production use still needs one deployment-specific decision: how the narration file becomes reachable by HeyGen (asset upload or public object-storage URL). The mock renderer intentionally avoids making paid API calls.

## Next milestones

1. Wire provider selection from `.env` / project config.
2. Convert ElevenLabs character timestamps into sentence/word timing.
3. Add HeyGen asset upload, job polling, WebM download and cache.
4. Add PPTX -> PDF -> PNG conversion.
5. Replace mock presenter with transparent HeyGen WebM.
6. Add reusable medical animation components.
7. Add a small Web editor only after the CLI pipeline is stable.

## Safety / medical content

MedAvatar Studio is a production tool, not a medical decision system. Human review should remain in the publishing workflow for clinical claims, medication information, references, patient privacy and AI-avatar disclosure.
