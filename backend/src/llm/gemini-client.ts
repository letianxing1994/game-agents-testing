import axios from 'axios';
import { BaseLLMClient, LLMMessage, LLMResponse } from './base-llm-client.js';

export class GeminiClient extends BaseLLMClient {
  private baseURL = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(apiKey: string) {
    super(apiKey);
  }

  async chat(messages: LLMMessage[], options: any = {}): Promise<LLMResponse> {
    try {
      const model = options.model || 'gemini-2.0-flash-exp';

      // Convert messages to Gemini format
      const contents = this.convertMessagesToGeminiFormat(messages);

      const response = await axios.post(
        `${this.baseURL}/models/${model}:generateContent?key=${this.apiKey}`,
        {
          contents: contents,
          generationConfig: {
            temperature: options.temperature || 0.7,
            maxOutputTokens: options.maxTokens || 4000,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const candidate = response.data.candidates[0];
      const content = candidate.content.parts[0].text;

      return {
        content: content,
        usage: {
          promptTokens: response.data.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.data.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.data.usageMetadata?.totalTokenCount || 0,
        },
      };
    } catch (error: any) {
      console.error('Gemini API error:', error.response?.data || error.message);
      throw new Error(`Gemini API failed: ${error.message}`);
    }
  }

  private convertMessagesToGeminiFormat(messages: LLMMessage[]): any[] {
    const contents: any[] = [];
    let systemInstruction = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction += msg.content + '\n';
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    // Prepend system instruction if exists
    if (systemInstruction && contents.length > 0) {
      const firstUserMsg = contents.find(c => c.role === 'user');
      if (firstUserMsg) {
        firstUserMsg.parts[0].text = systemInstruction + '\n' + firstUserMsg.parts[0].text;
      }
    }

    return contents;
  }
}
