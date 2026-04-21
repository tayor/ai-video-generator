export type Orientation = 'portrait' | 'landscape';
export type VisualSourceProfile = 'hybrid' | 'stock-video' | 'stock-image' | 'ai-image';
export type VisualSourceType = 'stock_video' | 'stock_image' | 'ai_image';
export type CaptionPosition =
  | 'top'
  | 'center'
  | 'bottom_center'
  | 'bottom_left'
  | 'bottom_right';

export interface AppConfig {
  readonly cloudflareAccountId: string;
  readonly cloudflareApiToken: string;
  readonly kimiModel: string;
  readonly gemmaReviewModel: string;
  readonly fluxModel: string;
  readonly whisperModel: string;
  readonly melottsModel: string;
  readonly melottsLanguage: string;
  readonly narrationLanguage?: string | undefined;
  readonly kimiThinking: boolean;
  readonly fluxSteps: number;
  readonly pexelsApiKey?: string | undefined;
  readonly visualSourceProfile: VisualSourceProfile;
  readonly availableVisualSources: VisualSourceType[];
  readonly videoReviewEnabled: boolean;
  readonly videoReviewMaxIterations: number;
  readonly orientation: Orientation;
  readonly captionsEnabled: boolean;
  readonly captionFontName: string;
  readonly captionFontSize: number;
  readonly captionColor: string;
  readonly captionOutlineColor: string;
  readonly captionOutlineWidth: number;
  readonly captionPosition: CaptionPosition;
  readonly fps: number;
  readonly captionMaxWords: number;
  readonly captionMaxChars: number;
  readonly captionMaxDurationSeconds: number;
}

export interface CaptionWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

export interface CaptionCue {
  readonly cueIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface StoryPlan {
  readonly title: string;
  readonly narration: string;
  readonly visualStyle: string;
}

export interface VisualBeat {
  readonly cueIndex: number;
  readonly sourceType: VisualSourceType;
  readonly fallbackSourceType?: VisualSourceType | undefined;
  readonly stockQueries: string[];
  readonly fluxPrompt: string;
}

export interface VideoReviewResult {
  readonly approved: boolean;
  readonly summary: string;
  readonly issues: string[];
  readonly revisionPrompt: string;
  readonly observedOnScreenText?: string | undefined;
}

export interface GeneratedVideoResult {
  readonly outputPath: string;
  readonly manifestPath: string;
  readonly workDirectory?: string | undefined;
  readonly story: StoryPlan;
  readonly cueCount: number;
}
