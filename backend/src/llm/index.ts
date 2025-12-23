import { DeepSeekClient } from './deepseek-client.js';
import { GeminiClient } from './gemini-client.js';
import { BaseLLMClient } from './base-llm-client.js';

export class LLMFactory {
  private static deepseekClient: DeepSeekClient | null = null;
  private static geminiClient: GeminiClient | null = null;

  static initializeClients(deepseekKey: string, geminiKey: string): void {
    this.deepseekClient = new DeepSeekClient(deepseekKey);
    this.geminiClient = new GeminiClient(geminiKey);
  }

  static getDeepSeekClient(): DeepSeekClient {
    if (!this.deepseekClient) {
      throw new Error('DeepSeek client not initialized');
    }
    return this.deepseekClient;
  }

  static getGeminiClient(): GeminiClient {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized');
    }
    return this.geminiClient;
  }
}

export { DeepSeekClient, GeminiClient, BaseLLMClient };
export type { LLMMessage, LLMResponse } from './base-llm-client.js';
