import React from 'react';
import {Composition} from 'remotion';
import {MedAvatarVideo} from './Video';
import type {MedAvatarProject} from '../src/core/schema';

const defaultProject: MedAvatarProject = {
  version: '1.0',
  title: 'MedAvatar Demo',
  video: {width: 1920, height: 1080, fps: 25},
  scenes: [
    {
      id: 'scene-001',
      type: 'doctor_full',
      text: '医生数字人科普视频 Demo',
      durationInSeconds: 5,
      avatar: {layout: 'fullscreen', scale: 1},
    },
  ],
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="MedAvatarVideo"
    component={MedAvatarVideo}
    width={1920}
    height={1080}
    fps={25}
    durationInFrames={125}
    defaultProps={{project: defaultProject}}
    calculateMetadata={({props}) => {
      const project = props.project as MedAvatarProject;
      const duration = project.scenes.reduce(
        (sum, scene) => sum + Math.round(scene.durationInSeconds * project.video.fps),
        0,
      );
      return {
        width: project.video.width,
        height: project.video.height,
        fps: project.video.fps,
        durationInFrames: Math.max(project.video.fps, duration),
      };
    }}
  />
);
