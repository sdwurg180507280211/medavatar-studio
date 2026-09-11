import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {buildSceneFrameTimeline} from '../src/core/frameMath';
import {getCompositionLayout} from './layout';
import {AvatarTrack} from './PresenterTrack';
import {SceneView} from './SceneView';
import {SubtitleTrack} from './SubtitleTrack';
import type {MedAvatarVideoProps, RenderAssets} from './videoTypes';

export type {MedAvatarVideoProps, RenderAssets} from './videoTypes';

const BottomFade: React.FC = () => {
  const {width, height} = useVideoConfig();
  const metrics = getCompositionLayout(width, height);
  return <div style={{position:'absolute', left:0, right:0, bottom:0, height:metrics.bottomFadeHeight, background:'linear-gradient(180deg, rgba(4,14,22,0) 0%, rgba(4,14,22,.72) 78%)', zIndex:25}} />;
};

export const MedAvatarVideo: React.FC<MedAvatarVideoProps> = ({
  project,
  assets={slides:[]} as RenderAssets,
  captions=[],
}) => {
  const timeline = buildSceneFrameTimeline(project.scenes, project.video.fps);
  return (
    <AbsoluteFill>
      {timeline.map((span) => {
        const scene = project.scenes[span.index]!;
        const slideSrc = scene.slide ? assets.slides[scene.slide-1] : undefined;
        return (
          <Sequence key={scene.id} from={span.startFrame} durationInFrames={span.durationInFrames} premountFor={project.video.fps}>
            <SceneView scene={scene} slideSrc={slideSrc} durationInFrames={span.durationInFrames} />
          </Sequence>
        );
      })}
      <AvatarTrack project={project} assets={assets} />
      <BottomFade />
      <SubtitleTrack project={project} captions={captions} />
      {assets.narration ? <Audio src={staticFile(assets.narration)} /> : null}
    </AbsoluteFill>
  );
};
