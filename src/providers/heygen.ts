import type {AvatarProvider} from './types.js';

/**
 * HeyGen adapter boundary.
 *
 * The MVP keeps upload/poll/download outside the mock path so local rendering
 * never burns credits. `renderFromAudioUrl` is the first real integration
 * point once a publicly reachable narration URL is available.
 */
export class HeyGenAvatarProvider implements AvatarProvider {
  constructor(
    private readonly apiKey: string,
    private readonly avatarId: string,
  ) {}

  async render(): Promise<{videoPath: string}> {
    throw new Error(
      'HeyGen provider requires asset upload/public audio URL. Use AVATAR_PROVIDER=mock for the MVP, or implement the deployment-specific asset transport.',
    );
  }

  async renderFromAudioUrl(audioUrl: string) {
    const response = await fetch('https://api.heygen.com/v3/videos', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        video_inputs: [
          {
            character: {type: 'avatar', avatar_id: this.avatarId},
            voice: {type: 'audio', audio_url: audioUrl},
          },
        ],
        dimension: {width: 1920, height: 1080},
      }),
    });
    if (!response.ok) {
      throw new Error(`HeyGen failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }
}
