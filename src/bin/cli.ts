#!/usr/bin/env node

import { Command } from 'commander';

import { runDoctor } from '../commands/doctor.js';
import { runGenerate } from '../commands/generate.js';
import { runInit } from '../commands/init.js';
import { runReviewSample } from '../commands/review-sample.js';
import { getErrorMessage } from '../lib/errors.js';

const program = new Command();

program
  .name('ai-video-generator')
  .description('Generate narrated short-form videos with Cloudflare Workers AI, Pexels, and ffmpeg.')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate a video from a prompt.')
  .argument('<prompt...>', 'video topic or prompt')
  .option('-o, --output <path>', 'output .mp4 path or output directory', 'generated-videos')
  .option('--orientation <orientation>', 'portrait or landscape')
  .option('--reference-image <paths...>', 'reference images for Kimi K2.6 vision guidance')
  .option('--no-captions', 'disable burned-in captions')
  .option('--keep-temp', 'keep the ffmpeg work directory for debugging')
  .action(async (prompt: string[], options) => {
    await runGenerate(prompt, options);
  });

program
  .command('init')
  .description('Create .env and .env.example with Cloudflare + Pexels settings.')
  .option(
    '--profile <profile>',
    'available source pool: hybrid, stock-video, stock-image, or ai-image',
    'hybrid'
  )
  .option('--force', 'overwrite an existing .env file')
  .action(async (options) => {
    await runInit(options);
  });

program
  .command('doctor')
  .description('Check ffmpeg and environment configuration.')
  .action(async () => {
    await runDoctor();
  });

program
  .command('review-sample')
  .description('Create a small sample video and verify the Gemma reviewer can read it.')
  .action(async () => {
    await runReviewSample();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
