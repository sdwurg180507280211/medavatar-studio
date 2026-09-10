#!/usr/bin/env python3
"""Matte the presenter out of an opaque avatar video.

HeyGen instant avatars are trained without matting, so the API returns the
original recorded background no matter which background/transparency options
are requested. This script removes the background locally with MediaPipe
selfie segmentation and re-encodes the clip as a VP9 webm with a real alpha
channel (yuva420p), which Remotion composites natively.

Usage: matte_avatar.py <input-video> <output-webm>
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

import mediapipe as mp

VIDEO_FPS = 25


def extract_frames(video: Path, frames_dir: Path) -> int:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), str(frames_dir / "%05d.png")],
        check=True,
    )
    return len(list(frames_dir.glob("*.png")))


def matte_frames(frames_dir: Path, matte_dir: Path) -> None:
    segmenter = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)
    boxes = []
    for frame_path in sorted(frames_dir.glob("*.png")):
        image = Image.open(frame_path).convert("RGB")
        result = segmenter.process(np.asarray(image))
        mask = (result.segmentation_mask * 255).astype(np.uint8)
        mask_image = Image.fromarray(mask).resize(image.size, Image.BILINEAR)
        # Feather the boundary and pull it slightly inward to drop background fringe.
        mask_image = mask_image.filter(ImageFilter.MinFilter(5)).filter(
            ImageFilter.GaussianBlur(2.5)
        )
        rgba = image.convert("RGBA")
        rgba.putalpha(mask_image)
        rgba.save(matte_dir / frame_path.name)
        solid = np.asarray(mask_image) > 127
        if solid.any():
            ys, xs = np.where(solid)
            boxes.append((xs.min(), ys.min(), xs.max(), ys.max()))
    segmenter.close()
    return boxes


def crop_to_person(matte_dir: Path, boxes) -> tuple[int, int, int, int]:
    """Union of per-frame person boxes + margin, so the crop is stable."""
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    margin_x = int((right - left) * 0.04)
    margin_y = int((bottom - top) * 0.04)
    return (left - margin_x, top - margin_y, right + margin_x, bottom + margin_y)


def apply_crop(matte_dir: Path, crop: tuple[int, int, int, int]) -> None:
    for frame_path in matte_dir.glob("*.png"):
        image = Image.open(frame_path)
        image.crop(crop).save(frame_path)


def encode_webm(matte_dir: Path, output: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-framerate", str(VIDEO_FPS),
            "-i", str(matte_dir / "%05d.png"),
            "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
            "-b:v", "0", "-crf", "30", "-auto-alt-ref", "0",
            "-an", str(output),
        ],
        check=True,
    )


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    video, output = Path(sys.argv[1]), Path(sys.argv[2])
    work = Path(tempfile.mkdtemp(prefix="medavatar-matte-"))
    frames_dir, matte_dir = work / "frames", work / "matte"
    frames_dir.mkdir()
    matte_dir.mkdir()
    try:
        count = extract_frames(video, frames_dir)
        if count == 0:
            sys.exit(f"no frames extracted from {video}")
        print(f"matting {count} frames...")
        boxes = matte_frames(frames_dir, matte_dir)
        if boxes:
            apply_crop(matte_dir, crop_to_person(matte_dir, boxes))
        encode_webm(matte_dir, output)
        print(f"matted -> {output}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
