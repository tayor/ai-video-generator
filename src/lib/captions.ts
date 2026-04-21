import type { AppConfig, CaptionCue, CaptionWord, Orientation } from './types.js';

const namedColors: Record<string, string> = {
  white: '#ffffff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  magenta: '#ff00ff',
  black: '#000000'
};

interface DisplayWord {
  readonly cueWord: CaptionWord;
  readonly text: string;
  readonly ordinal: number;
}

function normalizeHexColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  const named = namedColors[trimmed];
  if (named) {
    return named;
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  return '#ffffff';
}

function hexToAssColor(color: string): string {
  const normalized = normalizeHexColor(color).replace('#', '');
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  return `&H00${blue}${green}${red}`.toUpperCase();
}

function sanitizeWord(word: string): string {
  return word.replace(/\s+/g, ' ').trim();
}

export function buildCaptionCues(
  words: readonly CaptionWord[],
  config: Pick<AppConfig, 'captionMaxChars' | 'captionMaxDurationSeconds' | 'captionMaxWords'>
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let currentWords: CaptionWord[] = [];
  let cueStart = 0;
  let cueEnd = 0;

  const pushCue = (): void => {
    if (currentWords.length === 0) {
      return;
    }

    cues.push({
      cueIndex: cues.length,
      start: cueStart,
      end: cueEnd,
      text: currentWords.map((word) => word.word).join(' '),
      words: currentWords
    });
    currentWords = [];
  };

  for (const rawWord of words) {
    const word = sanitizeWord(rawWord.word);
    if (!word) {
      continue;
    }

    const normalizedWord: CaptionWord = {
      word,
      start: rawWord.start,
      end: Math.max(rawWord.end, rawWord.start + 0.1)
    };

    if (currentWords.length === 0) {
      cueStart = normalizedWord.start;
      cueEnd = normalizedWord.end;
      currentWords = [normalizedWord];
      continue;
    }

    const prospectiveText = [...currentWords.map((currentWord) => currentWord.word), word].join(' ');
    const prospectiveDuration = normalizedWord.end - cueStart;
    const shouldStartNewCue =
      currentWords.length >= config.captionMaxWords ||
      prospectiveText.length > config.captionMaxChars ||
      prospectiveDuration > config.captionMaxDurationSeconds;

    if (shouldStartNewCue) {
      pushCue();
      cueStart = normalizedWord.start;
      cueEnd = normalizedWord.end;
      currentWords = [normalizedWord];
      continue;
    }

    currentWords.push(normalizedWord);
    cueEnd = Math.max(normalizedWord.end, cueEnd);
  }

  pushCue();
  return cues;
}

function formatAssTimestamp(seconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const secs = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(
    2,
    '0'
  )}.${String(centiseconds).padStart(2, '0')}`;
}

function getDimensions(orientation: Orientation): { width: number; height: number } {
  return orientation === 'portrait'
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
}

function getAlignment(position: AppConfig['captionPosition']): number {
  switch (position) {
    case 'top':
      return 8;
    case 'center':
      return 5;
    case 'bottom_left':
      return 1;
    case 'bottom_right':
      return 3;
    case 'bottom_center':
    default:
      return 2;
  }
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function formatDisplayWord(word: string, style: AppConfig['captionStyle']): string {
  return style === 'tiktok' ? word.toUpperCase() : word;
}

function estimateCharacterWidth(character: string, fontSize: number, bold: boolean): number {
  if (character === ' ') {
    return fontSize * 0.34;
  }

  if ('MW@%#&'.includes(character)) {
    return fontSize * 0.92;
  }

  if ('IJ1'.includes(character)) {
    return fontSize * 0.4;
  }

  if (/[.,'!:;]/.test(character)) {
    return fontSize * 0.3;
  }

  return fontSize * (bold ? 0.69 : 0.61);
}

function estimateTextWidth(text: string, fontSize: number, bold: boolean): number {
  return [...text].reduce(
    (totalWidth, character) => totalWidth + estimateCharacterWidth(character, fontSize, bold),
    0
  );
}

function partitionWordsIntoLines(
  words: readonly DisplayWord[],
  maxLines: number
): DisplayWord[][][] {
  const partitions: DisplayWord[][][] = [];

  const search = (startIndex: number, lines: DisplayWord[][]): void => {
    if (startIndex >= words.length) {
      partitions.push(lines);
      return;
    }

    const linesRemaining = maxLines - lines.length;
    if (linesRemaining <= 0) {
      return;
    }

    if (linesRemaining === 1) {
      partitions.push([...lines, words.slice(startIndex)]);
      return;
    }

    for (let endIndex = startIndex + 1; endIndex <= words.length; endIndex += 1) {
      search(endIndex, [...lines, words.slice(startIndex, endIndex)]);
    }
  };

  search(0, []);
  return partitions;
}

function getMaxLineWidth(orientation: Orientation, style: AppConfig['captionStyle']): number {
  const { width } = getDimensions(orientation);
  return Math.round(width * (style === 'tiktok' ? 0.74 : 0.82));
}

function layoutCueWords(
  cue: CaptionCue,
  config: Pick<AppConfig, 'captionBold' | 'captionFontSize' | 'captionStyle'>,
  orientation: Orientation
): DisplayWord[][] {
  const displayWords = cue.words.map((word, ordinal) => ({
    cueWord: word,
    text: formatDisplayWord(word.word, config.captionStyle),
    ordinal
  }));

  if (displayWords.length === 0) {
    return [];
  }

  const maxLines = config.captionStyle === 'tiktok' && orientation === 'portrait' ? 3 : 2;
  const maxLineWidth = getMaxLineWidth(orientation, config.captionStyle);
  const candidateLayouts = partitionWordsIntoLines(displayWords, maxLines);

  let bestLayout = candidateLayouts[0] ?? [displayWords];
  let bestScore: readonly [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  ];

  for (const layout of candidateLayouts) {
    const lineWidths = layout.map((line) =>
      estimateTextWidth(
        line.map((word) => word.text).join(' '),
        config.captionFontSize,
        config.captionBold
      )
    );
    const overflow = lineWidths.reduce(
      (totalOverflow, lineWidth) => totalOverflow + Math.max(0, lineWidth - maxLineWidth),
      0
    );
    const longestLine = Math.max(...lineWidths);
    const shortestLine = Math.min(...lineWidths);
    const score: readonly [number, number, number, number] = [
      overflow,
      layout.length,
      longestLine,
      longestLine - shortestLine
    ];

    if (
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2]) ||
      (score[0] === bestScore[0] &&
        score[1] === bestScore[1] &&
        score[2] === bestScore[2] &&
        score[3] < bestScore[3])
    ) {
      bestLayout = layout;
      bestScore = score;
    }
  }

  return bestLayout;
}

function buildBaseDialogueText(lines: readonly DisplayWord[][]): string {
  return lines
    .map((line) => line.map((word) => escapeAssText(word.text)).join(' '))
    .join('\\N');
}

function buildHighlightOverlayText(
  lines: readonly DisplayWord[][],
  activeOrdinal: number
): string {
  return lines
    .map((line) =>
      line
        .map((word) => {
          const escapedWord = escapeAssText(word.text);
          if (word.ordinal === activeOrdinal) {
            return `{\\rActiveWord}${escapedWord}{\\rDefault}`;
          }

          return `{\\alpha&HFF&}${escapedWord}{\\alpha&H00&}`;
        })
        .join(' ')
    )
    .join('\\N');
}

function buildDialogueEvents(
  cue: CaptionCue,
  config: Pick<AppConfig, 'captionBold' | 'captionFontSize' | 'captionStyle'>,
  orientation: Orientation
): string[] {
  const lines = layoutCueWords(cue, config, orientation);
  const baseText =
    lines.length > 0
      ? buildBaseDialogueText(lines)
      : escapeAssText(formatDisplayWord(cue.text, config.captionStyle));

  if (config.captionStyle !== 'tiktok' || cue.words.length === 0) {
    return [
      `Dialogue: 0,${formatAssTimestamp(cue.start)},${formatAssTimestamp(cue.end)},Default,,0,0,0,,${baseText}`
    ];
  }

  const events = [
    `Dialogue: 0,${formatAssTimestamp(cue.start)},${formatAssTimestamp(cue.end)},Default,,0,0,0,,${baseText}`
  ];

  for (const [index, word] of cue.words.entries()) {
    const overlayEnd = Math.max(
      word.end,
      cue.words[index + 1]?.start ?? cue.end,
      word.start + 0.1
    );

    events.push(
      `Dialogue: 1,${formatAssTimestamp(word.start)},${formatAssTimestamp(overlayEnd)},Default,,0,0,0,,${buildHighlightOverlayText(
        lines,
        index
      )}`
    );
  }

  return events;
}

export function createAssSubtitles(
  cues: readonly CaptionCue[],
  config: Pick<
    AppConfig,
    | 'captionBold'
    | 'captionColor'
    | 'captionFontName'
    | 'captionFontSize'
    | 'captionHighlightColor'
    | 'captionOutlineColor'
    | 'captionOutlineWidth'
    | 'captionPosition'
    | 'captionShadowDepth'
    | 'captionStyle'
  >,
  orientation: Orientation
): string {
  const dimensions = getDimensions(orientation);
  const marginV =
    config.captionPosition === 'top'
      ? 80
      : config.captionStyle === 'tiktok' && orientation === 'portrait'
        ? 260
        : orientation === 'portrait'
          ? 140
          : 90;

  const events = cues
    .flatMap((cue) => buildDialogueEvents(cue, config, orientation))
    .join('\n');

  const activeWordStyle =
    config.captionStyle === 'tiktok'
      ? `\nStyle: ActiveWord,${config.captionFontName},${config.captionFontSize},${hexToAssColor(
          config.captionColor
        )},${hexToAssColor(config.captionColor)},${hexToAssColor(
          config.captionHighlightColor
        )},${hexToAssColor(config.captionHighlightColor)},${config.captionBold ? -1 : 0},0,0,0,100,100,0,0,3,${Math.max(
          2,
          config.captionOutlineWidth / 2
        )},0,${getAlignment(
          config.captionPosition
        )},70,70,${marginV},1`
      : '';

  return `[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: ${dimensions.width}
PlayResY: ${dimensions.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${config.captionFontName},${config.captionFontSize},${hexToAssColor(
    config.captionColor
  )},${hexToAssColor(config.captionColor)},${hexToAssColor(
    config.captionOutlineColor
  )},&H64000000,${config.captionBold ? -1 : 0},0,0,0,100,100,0,0,1,${config.captionOutlineWidth},${config.captionShadowDepth},${getAlignment(
    config.captionPosition
  )},70,70,${marginV},1${activeWordStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}
