import { describe, expect, it } from 'vitest';

import { buildCaptionCues, createAssSubtitles } from '../src/lib/captions.js';

describe('caption helpers', () => {
  it('groups words into bounded caption cues', () => {
    const cues = buildCaptionCues(
      [
        { word: 'Cloudflare', start: 0, end: 0.5 },
        { word: 'ships', start: 0.5, end: 0.9 },
        { word: 'Workers', start: 0.9, end: 1.4 },
        { word: 'AI', start: 1.4, end: 1.7 },
        { word: 'models', start: 1.7, end: 2.2 }
      ],
      {
        captionMaxWords: 2,
        captionMaxChars: 30,
        captionMaxDurationSeconds: 4
      }
    );

    expect(cues).toHaveLength(3);
    expect(cues[0]?.text).toBe('Cloudflare ships');
    expect(cues[1]?.cueIndex).toBe(1);
  });

  it('renders ass subtitles with expected alignment', () => {
    const ass = createAssSubtitles(
      [
        {
          cueIndex: 0,
          start: 0,
          end: 1.5,
          text: 'Hello world'
        }
      ],
      {
        captionColor: 'white',
        captionFontName: 'Arial',
        captionFontSize: 64,
        captionOutlineColor: 'black',
        captionOutlineWidth: 3,
        captionPosition: 'bottom_center'
      },
      'portrait'
    );

    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.50');
    expect(ass).toContain('Alignment, MarginL, MarginR, MarginV');
  });
});
