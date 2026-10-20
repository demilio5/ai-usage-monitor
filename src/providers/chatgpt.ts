import { ProviderError } from './http';
export async function fetchChatGPT(): Promise<never> {
  throw new ProviderError(
    'unavailable',
    'No verified overall ChatGPT subscription quota percentage is available. Model limits vary; Codex is tracked separately.',
  );
}
