import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createEnvTemplate } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import type { VisualSourceProfile } from '../lib/types.js';
import { pathExists } from '../lib/utils.js';

export interface InitCommandOptions {
  readonly profile?: VisualSourceProfile;
  readonly force?: boolean;
}

export async function runInit(options: InitCommandOptions): Promise<void> {
  const profile = options.profile ?? 'hybrid';
  const envTemplate = createEnvTemplate(profile);
  const envExamplePath = path.join(process.cwd(), '.env.example');
  const envPath = path.join(process.cwd(), '.env');

  await writeFile(envExamplePath, envTemplate, 'utf8');

  const envExists = await pathExists(envPath);
  if (envExists && !options.force) {
    console.log(`Updated ${envExamplePath}`);
    console.log(`Skipped ${envPath} because it already exists. Use --force to overwrite it.`);
    return;
  }

  if (envExists && options.force !== true) {
    throw new CliError('Refusing to overwrite .env without --force.');
  }

  await writeFile(envPath, envTemplate, 'utf8');
  console.log(`Wrote ${envPath}`);
  console.log(`Wrote ${envExamplePath}`);
  console.log('Next steps: add your Cloudflare account ID/token, then run `ai-video-generator doctor`.');
}
