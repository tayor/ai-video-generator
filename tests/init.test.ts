import { describe, expect, it } from 'vitest';

import { createEnvTemplate } from '../src/lib/config.js';

describe('init onboarding template', () => {
  it('documents cloudflare account configuration in the generated env template', () => {
    const template = createEnvTemplate('hybrid');

    expect(template).toContain('CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here');
    expect(template).toContain('CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here');
    expect(template).toContain('CLOUDFLARE_GEMMA_REVIEW_MODEL=@cf/google/gemma-4-26b-a4b-it');
    expect(template).toContain('VIDEO_REVIEW_ENABLED=true');
    expect(template).toContain('VISUAL_SOURCE_PROFILE=hybrid');
    expect(template).toContain('CAPTION_STYLE=tiktok');
    expect(template).toContain('CAPTION_FONT_FACE=NanumSquareRound');
  });
});
