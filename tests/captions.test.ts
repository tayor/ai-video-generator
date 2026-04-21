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
    expect(cues[0]?.words).toEqual([
      { word: 'Cloudflare', start: 0, end: 0.5 },
      { word: 'ships', start: 0.5, end: 0.9 }
    ]);
  });

  it('renders centered tiktok-style boxed word highlights one word at a time', () => {
    const ass = createAssSubtitles(
      [
        {
          cueIndex: 0,
          start: 0,
          end: 1.5,
          text: 'Hello world',
          words: [
            { word: 'Hello', start: 0, end: 0.5 },
            { word: 'world', start: 0.5, end: 1.5 }
          ]
        }
      ],
      {
        captionBold: true,
        captionColor: 'white',
        captionFontName: 'Arial',
        captionFontSize: 72,
        captionHighlightColor: 'green',
        captionOutlineColor: 'black',
        captionOutlineWidth: 3,
        captionPosition: 'bottom_center',
        captionShadowDepth: 0,
        captionStyle: 'tiktok'
      },
      'portrait'
    );

    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.50,Default');
    expect(ass).toContain('HELLO WORLD');
    expect(ass).toContain('{\\rActiveWord}WORLD{\\rDefault}');
    expect(ass).toContain('{\\alpha&HFF&}HELLO{\\alpha&H00&}');
    expect(ass).toContain('Alignment, MarginL, MarginR, MarginV');
    expect(ass).toContain('Style: Default,Arial,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1');
    expect(ass).toContain('Style: ActiveWord,Arial,72,&H00FFFFFF,&H00FFFFFF,&H0000FF00,&H0000FF00,-1');
  });

  it('inserts line breaks when a tiktok caption would overflow horizontally', () => {
    const ass = createAssSubtitles(
      [
        {
          cueIndex: 0,
          start: 0,
          end: 2.4,
          text: 'Lava fountains over ancient volcanic ridges',
          words: [
            { word: 'Lava', start: 0.0, end: 0.4 },
            { word: 'fountains', start: 0.4, end: 0.8 },
            { word: 'over', start: 0.8, end: 1.1 },
            { word: 'ancient', start: 1.1, end: 1.5 },
            { word: 'volcanic', start: 1.5, end: 1.9 },
            { word: 'ridges', start: 1.9, end: 2.4 }
          ]
        }
      ],
      {
        captionBold: true,
        captionColor: 'white',
        captionFontName: 'Arial',
        captionFontSize: 72,
        captionHighlightColor: 'green',
        captionOutlineColor: 'black',
        captionOutlineWidth: 3,
        captionPosition: 'bottom_center',
        captionShadowDepth: 0,
        captionStyle: 'tiktok'
      },
      'portrait'
    );

    expect(ass).toContain('\\N');
  });
});
