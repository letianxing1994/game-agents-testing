import { BaseAgent } from './base-agent.js';
import { AgentType } from '../a2a/message-types.js';
import { BaseLLMClient } from '../llm/base-llm-client.js';
import { PersistenceManager } from '../storage/persistence.js';
import { Tool } from '../workflow/react-executor.js';

/**
 * Game Planner Agent
 * Responsible for creating Game Design Documents (GDD)
 * Uses DeepSeek-chat model
 */
export class PlannerAgent extends BaseAgent {
  constructor(
    llmClient: BaseLLMClient,
    persistenceManager: PersistenceManager,
    a2aServerUrl: string
  ) {
    super(AgentType.PLANNER, llmClient, persistenceManager, a2aServerUrl);
  }

  protected initializeTools(): void {
    this.tools = [
      {
        name: 'save_gdd',
        description: 'Save Game Design Document to file',
        parameters: {
          filename: 'string',
          content: 'string',
        },
        execute: async (params: any, context: any) => {
          const path = await this.persistenceManager.saveGDD(params.filename, params.content);
          context.variables.artifactPath = path;
          return { success: true, path };
        },
      },
      {
        name: 'read_gdd',
        description: 'Read existing Game Design Document',
        parameters: {
          filename: 'string',
        },
        execute: async (params: any) => {
          const content = await this.persistenceManager.readGDD(params.filename);
          return { content };
        },
      },
      {
        name: 'list_gdds',
        description: 'List all existing GDDs',
        parameters: {},
        execute: async () => {
          const files = await this.persistenceManager.listFiles('gdd');
          return { files };
        },
      },
      {
        name: 'brainstorm',
        description: 'Use LLM to brainstorm game ideas and mechanics',
        parameters: {
          topic: 'string',
        },
        execute: async (params: any) => {
          const response = await this.llmClient.chat([
            {
              role: 'system',
              content: 'You are a creative game designer. Help brainstorm game ideas and mechanics.',
            },
            {
              role: 'user',
              content: `Brainstorm ideas for: ${params.topic}`,
            },
          ]);
          return { ideas: response.content };
        },
      },
    ];
  }

  protected getDefaultGoal(): string {
    return `Create a comprehensive Game Design Document (GDD) for a new game.

The GDD should include:
1. Game Concept and Overview
2. Core Gameplay Mechanics
3. Art Style and Visual Direction
4. Technical Requirements
5. Target Platform (browser-based, TypeScript/JS/WebGL)
6. Level Design and Progression
7. User Interface Design

Consider any user messages or previous conversations. Save the final GDD using the save_gdd tool.`;
  }

  protected getSystemPrompt(): string {
    return `You are an expert game planner and designer. Your role is to create detailed Game Design Documents (GDD) that will guide the development of browser-based games.

You work with an Artist Agent and a Developer Agent. Your GDD will be the foundation for their work.

Focus on:
- Clear and detailed game mechanics
- Feasibility for web-based implementation (TypeScript, JavaScript, WebGL)
- Engaging gameplay that can be prototyped quickly
- Visual elements that can be created as 2D sprites or simple 3D models

Use the available tools to save your work and iterate on the design.`;
  }

  protected async processArtifact(artifact: any): Promise<void> {
    console.log(`[${this.type}] GDD created:`, artifact);
    // Artifact path is already set in the save_gdd tool
  }
}
