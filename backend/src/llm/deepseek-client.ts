import axios from 'axios';
import { BaseLLMClient, LLMMessage, LLMResponse } from './base-llm-client.js';

export class DeepSeekClient extends BaseLLMClient {
  private baseURL = 'https://api.deepseek.com/v1';

  constructor(apiKey: string) {
    super(apiKey);
  }

  async chat(messages: LLMMessage[], options: any = {}): Promise<LLMResponse> {
    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: options.model || 'deepseek-chat',
          messages: messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 4000,
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      );

      const choice = response.data.choices[0];
      return {
        content: choice.message.content,
        usage: {
          promptTokens: response.data.usage?.prompt_tokens || 0,
          completionTokens: response.data.usage?.completion_tokens || 0,
          totalTokens: response.data.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      console.error('DeepSeek API error:', error.response?.data || error.message);
      throw new Error(`DeepSeek API failed: ${error.message}`);
    }
  }
}
