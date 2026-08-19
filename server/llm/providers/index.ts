/**
 * Every provider profile, in display order. Adding a provider = add its file in
 * this folder and one line here (plus the ProviderName union in ../types.ts).
 */
import type { ProviderProfile } from './types';
import { openai } from './openai';
import { openaiCompatible } from './openai-compatible';
import { anthropic } from './anthropic';
import { chutes } from './chutes';
import { deepseek } from './deepseek';
import { electronhub } from './electronhub';
import { googleaistudio } from './googleaistudio';
import { mistral } from './mistral';
import { moonshot } from './moonshot';
import { nanogpt } from './nanogpt';
import { openrouter } from './openrouter';
import { perplexity } from './perplexity';
import { xai } from './xai';
import { zai } from './zai';

export const PROVIDER_PROFILES: ProviderProfile[] = [
	openai,
	openaiCompatible,
	anthropic,
	chutes,
	deepseek,
	electronhub,
	googleaistudio,
	mistral,
	moonshot,
	nanogpt,
	openrouter,
	perplexity,
	xai,
	zai
];
