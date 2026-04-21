import type { Orientation } from '../lib/types.js';
import { loadConfig } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import { generateVideo } from '../lib/pipeline.js';

export interface GenerateCommandOptions {
  readonly output?: string;
  readonly orientation?: Orientation;
  readonly referenceImage?: string[];
  readonly noCaptions?: boolean;
  readonly keepTemp?: boolean;
}

export async function runGenerate(promptParts: string[], options: GenerateCommandOptions): Promise<void> {
  const prompt = promptParts.join(' ').trim();
  if (!prompt) {
    throw new CliError('Provide a prompt, for example: ai-video-generator generate "volcano facts"');
  }

  const config = loadConfig({
    orientation: options.orientation,
    captionsEnabled: options.noCaptions ? false : undefined
  });

  const result = await generateVideo({
    config,
    prompt,
    outputPath: options.output ?? 'generated-videos',
    referenceImagePaths: options.referenceImage ?? [],
    keepTemp: Boolean(options.keepTemp)
  });

  console.log(`Created ${result.outputPath}`);
  console.log(`Saved manifest ${result.manifestPath}`);
  if (result.workDirectory) {
    console.log(`Kept temp work directory ${result.workDirectory}`);
  }
}
