import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

import { CliError } from './errors.js';
import type {
  AppConfig,
  CaptionCue,
  CaptionWord,
  StoryPlan,
  VideoReviewResult,
  VisualBeat
} from './types.js';
import { fileToDataUrl } from './utils.js';

const storyPlanSchema = z.object({
  title: z.string().min(1),
  narration: z.string().min(1),
  visual_style: z.string().min(1)
});

const visualBeatSchema = z.object({
  cue_index: z.number().int().nonnegative(),
  source_type: z.enum(['stock_video', 'stock_image', 'ai_image']),
  fallback_source_type: z.enum(['stock_video', 'stock_image', 'ai_image']).optional(),
  stock_queries: z.array(z.string().min(2)).min(1).max(3),
  flux_prompt: z.string().min(8)
});

const visualPlanSchema = z.object({
  beats: z.array(visualBeatSchema)
});

const videoReviewSchema = z.object({
  approved: z.boolean(),
  summary: z.string().min(1),
  issues: z.array(z.string().min(1)).max(6),
  revision_prompt: z.string().min(1),
  observed_on_screen_text: z.string().optional()
});

interface CloudflareEnvelope<TResult> {
  readonly success?: boolean;
  readonly errors?: Array<{ readonly message?: string }>;
  readonly result?: TResult;
}

export function buildImageContentPart(dataUrl: string): {
  readonly type: 'image_url';
  readonly image_url: { readonly url: string; readonly detail: 'auto' };
} {
  return {
    type: 'image_url',
    image_url: {
      url: dataUrl,
      detail: 'auto'
    }
  };
}

function extractTextOutput(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    if ('response' in result && typeof result.response === 'string') {
      return result.response;
    }

    if ('choices' in result && Array.isArray(result.choices)) {
      const firstChoice = result.choices[0];
      if (
        typeof firstChoice === 'object' &&
        firstChoice !== null &&
        'message' in firstChoice &&
        typeof firstChoice.message === 'object' &&
        firstChoice.message !== null &&
        'content' in firstChoice.message &&
        typeof firstChoice.message.content === 'string'
      ) {
        return firstChoice.message.content;
      }

      if (typeof firstChoice === 'object' && firstChoice !== null && 'text' in firstChoice) {
        const text = firstChoice.text;
        if (typeof text === 'string') {
          return text;
        }
      }
    }
  }

  throw new CliError('Cloudflare Workers AI returned no text response.');
}

async function buildReferenceImageParts(
  referenceImagePaths: readonly string[]
): Promise<Array<{ readonly type: 'image_url'; readonly image_url: { readonly url: string; readonly detail: 'auto' } }>> {
  const parts = await Promise.all(
    referenceImagePaths.map(async (referenceImagePath) => buildImageContentPart(await fileToDataUrl(referenceImagePath)))
  );
  return parts;
}

export class CloudflareAiClient {
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}`;
  }

  async runModel<TResult>(model: string, input: unknown): Promise<TResult> {
    const response = await fetch(`${this.baseUrl}/ai/run/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.cloudflareApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new CliError(`Cloudflare Workers AI request failed (${response.status}): ${details}`);
    }

    const payload = (await response.json()) as CloudflareEnvelope<TResult>;
    if (payload.success === false || payload.result === undefined) {
      const details =
        payload.errors?.map((error) => error.message).filter(Boolean).join('; ') ||
        'Cloudflare Workers AI returned no result.';
      throw new CliError(details);
    }

    return payload.result;
  }

  private async requestStructuredOutput<TOutput>(
    promptText: string,
    schemaName: string,
    schema: Record<string, unknown>,
    validator: z.ZodType<TOutput>,
    referenceImagePaths: readonly string[] = []
  ): Promise<TOutput> {
    const imageParts = await buildReferenceImageParts(referenceImagePaths);
    const userContent =
      imageParts.length === 0
        ? promptText
        : [{ type: 'text', text: promptText }, ...imageParts];

    const result = await this.runModel<{ response: string }>(this.config.kimiModel, {
      messages: [
        {
          role: 'system',
          content:
            'Return only valid JSON that matches the provided schema. Do not wrap the JSON in markdown.'
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          schema,
          strict: true
        }
      },
      chat_template_kwargs: {
        thinking: this.config.kimiThinking
      },
      temperature: 0.2
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractTextOutput(result));
    } catch (error) {
      throw new CliError(
        `Kimi returned invalid JSON for ${schemaName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return validator.parse(parsedJson);
  }

  async generateStoryPlan(
    prompt: string,
    referenceImagePaths: readonly string[],
    reviewerFeedback?: string
  ): Promise<StoryPlan> {
    const reviewerBlock = reviewerFeedback
      ? `\nReviewer feedback from the previous render attempt:\n${reviewerFeedback}\n\nRevise the story plan to address every issue without making the narration bloated.\n`
      : '';
    const response = await this.requestStructuredOutput(
      `Create a short-form narrated video plan for the following prompt.\n\nPrompt: ${prompt}\n${reviewerBlock}\nRequirements:\n- Write a concise spoken narration suitable for one short video.\n- Keep the narration under 150 words.\n- Start with a strong hook.\n- Avoid markdown, emojis, citations, or stage directions.\n- If reference images are attached, use them to align the tone, setting, or subject.\n`,
      'story_plan',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1 },
          narration: { type: 'string', minLength: 1 },
          visual_style: { type: 'string', minLength: 1 }
        },
        required: ['title', 'narration', 'visual_style']
      },
      storyPlanSchema,
      referenceImagePaths
    );

    return {
      title: response.title,
      narration: response.narration,
      visualStyle: response.visual_style
    };
  }

  async generateVisualPlan(
    story: StoryPlan,
    cues: readonly CaptionCue[],
    referenceImagePaths: readonly string[],
    reviewerFeedback?: string
  ): Promise<VisualBeat[]> {
    const availableSourceTypes = this.config.availableVisualSources;
    const reviewerBlock = reviewerFeedback
      ? `\nReviewer feedback from the previous render attempt:\n${reviewerFeedback}\n\nAdjust the beat choices to resolve those issues.\n`
      : '';
    const response = await this.requestStructuredOutput(
      `Create one visual beat for every caption cue in this narrated video.\n\nTitle: ${story.title}\nVisual style: ${story.visualStyle}\nNarration: ${story.narration}\nCaption cues: ${JSON.stringify(
        cues.map((cue) => ({
          cue_index: cue.cueIndex,
          start: cue.start,
          end: cue.end,
          text: cue.text
        }))
      )}\nAvailable source types: ${JSON.stringify(
        availableSourceTypes
      )}${reviewerBlock}\nRequirements:\n- Return exactly one beat for every cue_index.\n- source_type must be one of the available source types.\n- fallback_source_type is optional, must differ from source_type, and must also be one of the available source types.\n- Pick the source type per cue/cut based on the scene itself.\n- stock_queries must be short English search phrases that work on stock-media search APIs.\n- flux_prompt should be a richer prompt for image generation.\n- Never ask for captions, text overlays, watermarks, logos, or UI chrome unless the cue explicitly needs it.\n`,
      'visual_plan',
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          beats: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                cue_index: { type: 'integer', minimum: 0 },
                source_type: { type: 'string', enum: availableSourceTypes },
                fallback_source_type: { type: 'string', enum: availableSourceTypes },
                stock_queries: {
                  type: 'array',
                  items: { type: 'string', minLength: 2 },
                  minItems: 1,
                  maxItems: 3
                },
                flux_prompt: { type: 'string', minLength: 8 }
              },
              required: ['cue_index', 'source_type', 'stock_queries', 'flux_prompt']
            }
          }
        },
        required: ['beats']
      },
      visualPlanSchema,
      referenceImagePaths
    );

    const cueIndexes = new Set(cues.map((cue) => cue.cueIndex));
    const returnedIndexes = new Set(response.beats.map((beat) => beat.cue_index));

    for (const cueIndex of cueIndexes) {
      if (!returnedIndexes.has(cueIndex)) {
        throw new CliError(`Visual plan is missing cue_index=${cueIndex}.`);
      }
    }

    return response.beats
      .sort((left, right) => left.cue_index - right.cue_index)
      .map((beat) => ({
        cueIndex: beat.cue_index,
        sourceType: beat.source_type,
        fallbackSourceType: beat.fallback_source_type,
        stockQueries: beat.stock_queries,
        fluxPrompt: beat.flux_prompt
      }));
  }

  async identifyVideoTextFromFrames(framePaths: readonly string[]): Promise<string> {
    const imageParts = await buildReferenceImageParts(framePaths);
    const result = await this.runModel<unknown>(this.config.gemmaReviewModel, {
      messages: [
        {
          role: 'system',
          content: 'You are a precise multimodal reviewer. Read visible text from frames exactly.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'These are sequential frames from one short video. What exact text appears in the video? Reply only with the text.'
            },
            ...imageParts
          ]
        }
      ],
      temperature: 0
    });

    return extractTextOutput(result).trim();
  }

  async reviewVideoFrames(
    framePaths: readonly string[],
    input: {
      readonly prompt: string;
      readonly story: StoryPlan;
      readonly cues: readonly CaptionCue[];
      readonly reviewerFeedback?: string | undefined;
    }
  ): Promise<VideoReviewResult> {
    const imageParts = await buildReferenceImageParts(framePaths);
    const result = await this.runModel<unknown>(this.config.gemmaReviewModel, {
      messages: [
        {
          role: 'system',
          content:
            'You are a strict QA reviewer for short-form videos. Review the visual sequence against the requested brief and respond only with valid JSON matching the provided schema.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Review these sequential frames from a rendered video.\n\nOriginal prompt: ${input.prompt}\nTitle: ${input.story.title}\nNarration: ${input.story.narration}\nVisual style: ${input.story.visualStyle}\nCaption cues: ${JSON.stringify(
                input.cues.map((cue) => ({
                  cue_index: cue.cueIndex,
                  start: cue.start,
                  end: cue.end,
                  text: cue.text
                }))
              )}\n${
                input.reviewerFeedback
                  ? `Previous reviewer feedback that should already have been addressed: ${input.reviewerFeedback}\n`
                  : ''
              }\nRequirements:\n- approved should be true only if the frames clearly match the prompt and narration.\n- summary should briefly state whether the render works.\n- issues should list concrete problems, or be [] when approved.\n- revision_prompt should tell the generator exactly what to improve; if approved, say \"No changes needed.\".\n- observed_on_screen_text should quote notable text visible in the frames when relevant.\n`
            },
            ...imageParts
          ]
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'video_review',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              approved: { type: 'boolean' },
              summary: { type: 'string', minLength: 1 },
              issues: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
                maxItems: 6
              },
              revision_prompt: { type: 'string', minLength: 1 },
              observed_on_screen_text: { type: 'string' }
            },
            required: ['approved', 'summary', 'issues', 'revision_prompt']
          },
          strict: true
        }
      },
      temperature: 0
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractTextOutput(result));
    } catch (error) {
      throw new CliError(
        `Gemma reviewer returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const parsed = videoReviewSchema.parse(parsedJson);
    return {
      approved: parsed.approved,
      summary: parsed.summary,
      issues: parsed.issues,
      revisionPrompt: parsed.revision_prompt,
      observedOnScreenText: parsed.observed_on_screen_text
    };
  }

  async generateSpeech(audioText: string, outputPath: string): Promise<void> {
    const result = await this.runModel<{ audio: string }>(this.config.melottsModel, {
      prompt: audioText,
      lang: this.config.melottsLanguage
    });

    await writeFile(outputPath, Buffer.from(result.audio, 'base64'));
  }

  async transcribe(audioPath: string): Promise<{ words: CaptionWord[]; text: string; vtt?: string | undefined }> {
    const audio = await readFile(audioPath);
    const result = await this.runModel<{
      text: string;
      vtt?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
    }>(this.config.whisperModel, {
      audio: [...audio]
    });

    const words = (result.words ?? [])
      .filter((word): word is { word: string; start: number; end: number } =>
        Boolean(word.word) && typeof word.start === 'number' && typeof word.end === 'number'
      )
      .map((word) => ({
        word: word.word,
        start: word.start,
        end: word.end
      }));

    if (words.length === 0) {
      throw new CliError('Whisper returned no word-level timestamps.');
    }

    return {
      words,
      text: result.text,
      vtt: result.vtt
    };
  }

  async generateImage(prompt: string, outputPath: string): Promise<void> {
    const result = await this.runModel<{ image: string }>(this.config.fluxModel, {
      prompt,
      steps: this.config.fluxSteps
    });

    await writeFile(outputPath, Buffer.from(result.image, 'base64'));
  }
}
