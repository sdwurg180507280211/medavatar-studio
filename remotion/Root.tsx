import React from 'react';
import {Composition} from 'remotion';
import {getProjectDurationInFrames} from '../src/core/frameMath';
import {MedAvatarVideo} from './Video';
import type {MedAvatarProject} from '../src/core/schema';

const defaultProject: MedAvatarProject = {
  version: '1.0',
  title: 'MedAvatar Demo',
  video: {width: 1080, height: 1920, fps: 25},
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
    width={1080}
    height={1920}
    fps={25}
    durationInFrames={125}
    defaultProps={{project: defaultProject}}
    calculateMetadata={({props}) => {
      const project = props.project as MedAvatarProject;
      return {
        width: project.video.width,
        height: project.video.height,
        fps: project.video.fps,
        durationInFrames: getProjectDurationInFrames(project),
      };
    }}
  />
);
