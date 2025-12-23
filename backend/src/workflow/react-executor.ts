import { BaseLLMClient, LLMMessage } from '../llm/base-llm-client.js';

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any, context: any) => Promise<any>;
}

export interface ReActStep {
  thought: string;
  action: string;
  actionInput: any;
  observation: string;
}

export class ReActExecutor {
  private llmClient: BaseLLMClient;
  private tools: Map<string, Tool> = new Map();
  private maxIterations: number = 10;
  private progressCallback?: (step: ReActStep) => void;

  constructor(llmClient: BaseLLMClient, tools: Tool[] = []) {
    this.llmClient = llmClient;
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  setProgressCallback(callback: (step: ReActStep) => void): void {
    this.progressCallback = callback;
  }

  async execute(
    task: string,
    context: any = {},
    systemPrompt?: string
  ): Promise<{ success: boolean; result?: any; steps: ReActStep[] }> {
    const steps: ReActStep[] = [];
    const messages: LLMMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const toolsDescription = this.getToolsDescription();
    const initialPrompt = this.buildReActPrompt(task, toolsDescription, context);
    messages.push({ role: 'user', content: initialPrompt });

    for (let i = 0; i < this.maxIterations; i++) {
      try {
        const response = await this.llmClient.chat(messages);
        const parsed = this.parseReActResponse(response.content);

        if (parsed.action === 'FINISH') {
          const finalStep = { ...parsed, observation: 'Task completed' };
          steps.push(finalStep);
          if (this.progressCallback) {
            this.progressCallback(finalStep);
          }
          return {
            success: true,
            result: parsed.actionInput,
            steps,
          };
        }

        const tool = this.tools.get(parsed.action);
        if (!tool) {
          const observation = `Error: Tool "${parsed.action}" not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`;
          const step = { ...parsed, observation };
          steps.push(step);
          if (this.progressCallback) {
            this.progressCallback(step);
          }
          messages.push({
            role: 'assistant',
            content: response.content,
          });
          messages.push({
            role: 'user',
            content: `Observation: ${observation}\n\nContinue with your reasoning.`,
          });
          continue;
        }

        const observation = await tool.execute(parsed.actionInput, context);
        const step = { ...parsed, observation: JSON.stringify(observation) };
        steps.push(step);
        if (this.progressCallback) {
          this.progressCallback(step);
        }

        messages.push({
          role: 'assistant',
          content: response.content,
        });
        messages.push({
          role: 'user',
          content: `Observation: ${JSON.stringify(observation)}\n\nContinue with your reasoning.`,
        });
      } catch (error: any) {
        console.error('ReAct execution error:', error);
        return {
          success: false,
          result: error.message,
          steps,
        };
      }
    }

    return {
      success: false,
      result: 'Max iterations reached without completion',
      steps,
    };
  }

  private buildReActPrompt(task: string, toolsDescription: string, context: any): string {
    return `You are an AI agent using the ReAct (Reasoning and Acting) framework to solve tasks.

Task: ${task}

Context: ${JSON.stringify(context, null, 2)}

Available Tools:
${toolsDescription}

You must respond in the following format for each step:

Thought: [Your reasoning about what to do next]
Action: [The tool name to use, or "FINISH" when the task is complete]
Action Input: [The input for the tool as a JSON object, or the final result if Action is FINISH]

When you have completed the task, use:
Action: FINISH
Action Input: [Your final result]

Begin!`;
  }

  private getToolsDescription(): string {
    const descriptions: string[] = [];
    for (const [name, tool] of this.tools.entries()) {
      descriptions.push(`- ${name}: ${tool.description}`);
      descriptions.push(`  Parameters: ${JSON.stringify(tool.parameters)}`);
    }
    return descriptions.join('\n');
  }

  private parseReActResponse(response: string): {
    thought: string;
    action: string;
    actionInput: any;
  } {
    const thoughtMatch = response.match(/Thought:\s*(.+?)(?=\nAction:|\n\n|$)/s);
    const actionMatch = response.match(/Action:\s*(.+?)(?=\nAction Input:|\n\n|$)/s);
    const actionInputMatch = response.match(/Action Input:\s*(.+?)$/s);

    const thought = thoughtMatch ? thoughtMatch[1].trim() : '';
    const action = actionMatch ? actionMatch[1].trim() : 'FINISH';
    let actionInput: any = {};

    if (actionInputMatch) {
      const inputStr = actionInputMatch[1].trim();
      try {
        actionInput = JSON.parse(inputStr);
      } catch {
        actionInput = inputStr;
      }
    }

    return { thought, action, actionInput };
  }
}
