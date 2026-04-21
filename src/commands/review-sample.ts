import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../lib/config.js';
import { CloudflareAiClient } from '../lib/cloudflare.js';
import { CliError } from '../lib/errors.js';
import { createTextSampleVideo, ensureFfmpegInstalled, extractReviewFrames } from '../lib/render.js';
import { safeRemoveDirectory } from '../lib/utils.js';

export async function runReviewSample(): Promise<void> {
  const config = loadConfig();
  await ensureFfmpegInstalled();

  const workDirectory = await mkdtemp(path.join(os.tmpdir(), 'ai-video-review-sample-'));

  try {
    const sampleVideoPath = path.join(workDirectory, 'sample.mp4');
    await createTextSampleVideo(sampleVideoPath, 'HELLO REVIEWER');

    const framePaths = await extractReviewFrames(sampleVideoPath, path.join(workDirectory, 'frames'));
    const cloudflare = new CloudflareAiClient(config);
    const detectedText = await cloudflare.identifyVideoTextFromFrames(framePaths);

    if (!detectedText.toUpperCase().includes('HELLO REVIEWER')) {
      throw new CliError(`Gemma reviewer did not identify the sample video correctly: ${detectedText}`);
    }

    console.log(`Gemma identified: ${detectedText}`);
  } finally {
    await safeRemoveDirectory(workDirectory);
  }
}
