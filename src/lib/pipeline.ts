import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAssSubtitles, buildCaptionCues } from './captions.js';
import { CloudflareAiClient } from './cloudflare.js';
import { CliError, getErrorMessage } from './errors.js';
import { PexelsClient } from './pexels.js';
import {
  concatVideoSegments,
  ensureFfmpegInstalled,
  extractReviewFrames,
  muxNarrationAndSubtitles,
  prepareTranscriptionAudio,
  renderVisualSegment
} from './render.js';
import type {
  AppConfig,
  GeneratedVideoResult,
  StoryPlan,
  VideoReviewResult,
  VisualBeat,
  VisualSourceType
} from './types.js';
import { downloadToFile, ensureDir, safeRemoveDirectory, sha1, slugify, writeJsonFile } from './utils.js';

interface GenerateVideoOptions {
  readonly config: AppConfig;
  readonly prompt: string;
  readonly outputPath: string;
  readonly referenceImagePaths: readonly string[];
  readonly keepTemp: boolean;
}

async function resolveVisualAsset(
  beat: VisualBeat,
  story: StoryPlan,
  config: AppConfig,
  workDirectory: string,
  clients: { cloudflare: CloudflareAiClient; pexels?: PexelsClient | undefined },
  cache: Map<string, { type: 'video' | 'image'; path: string }>
): Promise<{ type: 'video' | 'image'; path: string }> {
  const sourceOrder = [
    beat.sourceType,
    ...(beat.fallbackSourceType && beat.fallbackSourceType !== beat.sourceType
      ? [beat.fallbackSourceType]
      : []),
    ...config.availableVisualSources.filter(
      (sourceType) => sourceType !== beat.sourceType && sourceType !== beat.fallbackSourceType
    )
  ];
  let lastError: unknown;

  for (const sourceType of sourceOrder) {
    try {
      if (sourceType === 'stock_video') {
        if (!clients.pexels) {
          continue;
        }

        const queryCacheKey = `stock_video:${beat.stockQueries.join('|')}`;
        const cachedAsset = cache.get(queryCacheKey);
        if (cachedAsset) {
          return cachedAsset;
        }

        for (const query of beat.stockQueries) {
          const videoUrl = await clients.pexels.findBestVideo(query, config.orientation);
          if (!videoUrl) {
            continue;
          }

          const assetPath = path.join(workDirectory, 'assets', `${sha1(videoUrl)}.mp4`);
          await ensureDir(path.dirname(assetPath));
          await downloadToFile(videoUrl, assetPath);
          const resolved = { type: 'video' as const, path: assetPath };
          cache.set(queryCacheKey, resolved);
          return resolved;
        }
        continue;
      }

      if (sourceType === 'stock_image') {
        if (!clients.pexels) {
          continue;
        }

        const queryCacheKey = `stock_image:${beat.stockQueries.join('|')}`;
        const cachedAsset = cache.get(queryCacheKey);
        if (cachedAsset) {
          return cachedAsset;
        }

        for (const query of beat.stockQueries) {
          const imageUrl = await clients.pexels.findBestPhoto(query, config.orientation);
          if (!imageUrl) {
            continue;
          }

          const assetPath = path.join(workDirectory, 'assets', `${sha1(imageUrl)}.jpg`);
          await ensureDir(path.dirname(assetPath));
          await downloadToFile(imageUrl, assetPath);
          const resolved = { type: 'image' as const, path: assetPath };
          cache.set(queryCacheKey, resolved);
          return resolved;
        }
        continue;
      }

      if (sourceType === 'ai_image') {
        const fluxCacheKey = `ai_image:${sha1(`${story.visualStyle}:${beat.fluxPrompt}`)}`;
        const cachedFluxAsset = cache.get(fluxCacheKey);
        if (cachedFluxAsset) {
          return cachedFluxAsset;
        }

        const fluxPath = path.join(workDirectory, 'assets', `${fluxCacheKey}.jpg`);
        await ensureDir(path.dirname(fluxPath));

        try {
          await clients.cloudflare.generateImage(`${story.visualStyle}. ${beat.fluxPrompt}`, fluxPath);
        } catch (error) {
          if (!getErrorMessage(error).includes('NSFW')) {
            throw error;
          }

          const saferPrompt = `${story.visualStyle}. Family-friendly, non-graphic visual for: ${
            beat.stockQueries[0] ?? beat.fluxPrompt
          }`;
          await clients.cloudflare.generateImage(saferPrompt, fluxPath);
        }

        const resolved = { type: 'image' as const, path: fluxPath };
        cache.set(fluxCacheKey, resolved);
        return resolved;
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  throw new CliError(
    `No asset could be resolved for cue ${beat.cueIndex} from the available source order.${
      lastError ? ` Last error: ${getErrorMessage(lastError)}` : ''
    }`
  );
}

function resolveOutputPath(requestedOutputPath: string, prompt: string): string {
  if (requestedOutputPath.toLowerCase().endsWith('.mp4')) {
    return path.resolve(requestedOutputPath);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(requestedOutputPath, `${slugify(prompt)}-${stamp}.mp4`);
}

function buildReviewerFeedback(review: VideoReviewResult): string {
  const issues = review.issues.length > 0 ? review.issues.map((issue) => `- ${issue}`).join('\n') : '- No specific issues listed.';
  return `Summary: ${review.summary}\nIssues:\n${issues}\nRevision prompt: ${review.revisionPrompt}${
    review.observedOnScreenText ? `\nObserved on-screen text: ${review.observedOnScreenText}` : ''
  }`;
}

export async function generateVideo(options: GenerateVideoOptions): Promise<GeneratedVideoResult> {
  await ensureFfmpegInstalled();

  const cloudflare = new CloudflareAiClient(options.config);
  const pexels = options.config.pexelsApiKey ? new PexelsClient(options.config.pexelsApiKey) : undefined;

  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'ai-video-generator-'));
  const assetCache = new Map<string, { type: 'video' | 'image'; path: string }>();

  try {
    const reviewHistory: Array<{
      readonly attempt: number;
      readonly approved: boolean;
      readonly summary: string;
      readonly issues: string[];
      readonly revisionPrompt: string;
      readonly observedOnScreenText?: string | undefined;
      readonly frameCount: number;
    }> = [];
    let reviewerFeedback: string | undefined;
    let finalAttempt:
      | {
          readonly attempt: number;
          readonly outputPath: string;
          readonly story: StoryPlan;
          readonly transcriptionText: string;
          readonly cues: ReturnType<typeof buildCaptionCues>;
          readonly visualPlan: VisualBeat[];
        }
      | undefined;

    for (let attempt = 0; attempt <= options.config.videoReviewMaxIterations; attempt += 1) {
      const attemptNumber = attempt + 1;
      const attemptDirectory = path.join(workDirectory, `attempt-${attemptNumber}`);
      const segmentDirectory = path.join(attemptDirectory, 'segments');
      await ensureDir(segmentDirectory);

      const story = await cloudflare.generateStoryPlan(
        options.prompt,
        options.referenceImagePaths,
        reviewerFeedback
      );

      const narrationPath = path.join(attemptDirectory, 'narration.mp3');
      await cloudflare.generateSpeech(story.narration, narrationPath);

      const transcriptionAudioPath = path.join(attemptDirectory, 'transcription.ogg');
      await prepareTranscriptionAudio(narrationPath, transcriptionAudioPath);

      const transcription = await cloudflare.transcribe(transcriptionAudioPath);
      const cues = buildCaptionCues(transcription.words, options.config);
      if (cues.length === 0) {
        throw new CliError('Whisper produced no caption cues.');
      }

      const visualPlan = await cloudflare.generateVisualPlan(
        story,
        cues,
        options.referenceImagePaths,
        reviewerFeedback
      );

      const segmentPaths: string[] = [];
      for (const beat of visualPlan) {
        const cue = cues[beat.cueIndex];
        if (!cue) {
          throw new CliError(`Visual plan referenced unknown cue_index=${beat.cueIndex}.`);
        }

        const resolvedAsset = await resolveVisualAsset(
          beat,
          story,
          options.config,
          workDirectory,
          { cloudflare, pexels },
          assetCache
        );

        const segmentPath = path.join(segmentDirectory, `${String(cue.cueIndex).padStart(3, '0')}.mp4`);
        await renderVisualSegment(
          resolvedAsset.path,
          resolvedAsset.type,
          segmentPath,
          Math.max(0.2, cue.end - cue.start),
          options.config.orientation,
          options.config.fps
        );
        segmentPaths.push(segmentPath);
      }

      const visualsPath = path.join(attemptDirectory, 'visuals.mp4');
      await concatVideoSegments(segmentPaths, path.join(attemptDirectory, 'segments.txt'), visualsPath);

      let subtitlesPath: string | undefined;
      if (options.config.captionsEnabled) {
        subtitlesPath = path.join(attemptDirectory, 'captions.ass');
        const subtitles = createAssSubtitles(cues, options.config, options.config.orientation);
        await writeFile(subtitlesPath, subtitles, 'utf8');
      }

      const candidateOutputPath = path.join(attemptDirectory, 'candidate.mp4');
      await muxNarrationAndSubtitles(visualsPath, narrationPath, candidateOutputPath, subtitlesPath);

      finalAttempt = {
        attempt: attemptNumber,
        outputPath: candidateOutputPath,
        story,
        transcriptionText: transcription.text,
        cues,
        visualPlan
      };

      if (!options.config.videoReviewEnabled) {
        break;
      }

      const reviewFrames = await extractReviewFrames(
        candidateOutputPath,
        path.join(attemptDirectory, 'review-frames')
      );
      const review = await cloudflare.reviewVideoFrames(reviewFrames, {
        prompt: options.prompt,
        story,
        cues,
        reviewerFeedback
      });
      reviewHistory.push({
        attempt: attemptNumber,
        approved: review.approved,
        summary: review.summary,
        issues: review.issues,
        revisionPrompt: review.revisionPrompt,
        observedOnScreenText: review.observedOnScreenText,
        frameCount: reviewFrames.length
      });

      if (review.approved || attempt === options.config.videoReviewMaxIterations) {
        break;
      }

      reviewerFeedback = buildReviewerFeedback(review);
    }

    if (!finalAttempt) {
      throw new CliError('Video generation finished without producing a rendered output.');
    }

    const outputPath = resolveOutputPath(options.outputPath, finalAttempt.story.title);
    await ensureDir(path.dirname(outputPath));
    await copyFile(finalAttempt.outputPath, outputPath);

    const manifestPath = outputPath.replace(/\.mp4$/i, '.json');
    await writeJsonFile(manifestPath, {
      prompt: options.prompt,
      outputPath,
      story: finalAttempt.story,
      transcriptionText: finalAttempt.transcriptionText,
      cues: finalAttempt.cues,
      visualPlan: finalAttempt.visualPlan,
      visualSourceProfile: options.config.visualSourceProfile,
      availableVisualSources: options.config.availableVisualSources,
      referenceImagePaths: options.referenceImagePaths,
      videoReviewEnabled: options.config.videoReviewEnabled,
      videoReviewMaxIterations: options.config.videoReviewMaxIterations,
      reviewHistory
    });

    if (!options.keepTemp) {
      await safeRemoveDirectory(workDirectory);
      return {
        outputPath,
        manifestPath,
        story: finalAttempt.story,
        cueCount: finalAttempt.cues.length
      };
    }

    return {
      outputPath,
      manifestPath,
      story: finalAttempt.story,
      cueCount: finalAttempt.cues.length,
      workDirectory
    };
  } catch (error) {
    if (!options.keepTemp) {
      await safeRemoveDirectory(workDirectory);
    }
    throw error;
  }
}
