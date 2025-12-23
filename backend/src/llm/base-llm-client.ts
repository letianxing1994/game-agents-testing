import axios from 'axios';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export abstract class BaseLLMClient {
  protected apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  abstract chat(messages: LLMMessage[], options?: any): Promise<LLMResponse>;
}
