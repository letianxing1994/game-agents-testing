import { BaseAgent } from './base-agent.js';
import { AgentType } from '../a2a/message-types.js';
import { BaseLLMClient } from '../llm/base-llm-client.js';
import { PersistenceManager } from '../storage/persistence.js';
import { Tool } from '../workflow/react-executor.js';

/**
 * Game Artist Agent
 * Responsible for creating 2D sprites and 3D models
 * Uses Gemini 2.0 Flash model
 */
export class ArtistAgent extends BaseAgent {
  constructor(
    llmClient: BaseLLMClient,
    persistenceManager: PersistenceManager,
    a2aServerUrl: string
  ) {
    super(AgentType.ARTIST, llmClient, persistenceManager, a2aServerUrl);
  }

  protected initializeTools(): void {
    this.tools = [
      {
        name: 'create_sprite_description',
        description: 'Create detailed description for 2D sprite based on GDD',
        parameters: {
          spriteName: 'string',
          requirements: 'string',
        },
        execute: async (params: any) => {
          const response = await this.llmClient.chat([
            {
              role: 'system',
              content: 'You are an expert game artist. Create detailed sprite descriptions for game assets.',
            },
            {
              role: 'user',
              content: `Create a detailed description for a 2D sprite: ${params.spriteName}\nRequirements: ${params.requirements}`,
            },
          ]);
          return { description: response.content };
        },
      },
      {
        name: 'save_asset_spec',
        description: 'Save asset specification document',
        parameters: {
          filename: 'string',
          content: 'string',
        },
        execute: async (params: any, context: any) => {
          const path = await this.persistenceManager.saveAsset(
            params.filename,
            params.content
          );
          context.variables.artifactPath = path;
          return { success: true, path };
        },
      },
      {
        name: 'read_gdd',
        description: 'Read the Game Design Document from planner',
        parameters: {
          path: 'string',
        },
        execute: async (params: any) => {
          const content = await this.persistenceManager.readGDD(
            params.path.split('/').pop()
          );
          return { content };
        },
      },
      {
        name: 'generate_svg_sprite',
        description: 'Generate simple SVG sprite code',
        parameters: {
          description: 'string',
          width: 'number',
          height: 'number',
        },
        execute: async (params: any) => {
          const response = await this.llmClient.chat([
            {
              role: 'system',
              content: 'You are an expert at creating SVG graphics. Generate valid SVG code based on descriptions.',
            },
            {
              role: 'user',
              content: `Create an SVG sprite (${params.width}x${params.height}): ${params.description}\n\nProvide only the SVG code.`,
            },
          ]);
          return { svg: response.content };
        },
      },
      {
        name: 'list_assets',
        description: 'List all created assets',
        parameters: {},
        execute: async () => {
          const files = await this.persistenceManager.listFiles('assets');
          return { files };
        },
      },
    ];
  }

  protected getDefaultGoal(): string {
    return `Create game art assets based on the Game Design Document.

Tasks:
1. Read the GDD from the planner agent (if available)
2. Identify all visual assets needed (sprites, backgrounds, UI elements)
3. Create detailed specifications for each asset
4. Generate SVG sprites or 3D model descriptions
5. Save all asset specifications and generated files

Focus on creating assets that can be used in a web-based game (TypeScript/JS/WebGL).

Save your final asset package using the save_asset_spec tool.`;
  }

  protected getSystemPrompt(): string {
    return `You are an expert game artist specializing in 2D sprites and 3D models for web-based games.

Your role is to:
- Interpret Game Design Documents
- Create visual assets that match the game's art style
- Generate SVG sprites for 2D games
- Write specifications for 3D models
- Ensure all assets are optimized for web rendering

You work closely with the Planner Agent (who provides the GDD) and the Developer Agent (who will implement the game).

Use the available tools to access the GDD and create/save your art assets.`;
  }

  protected async processArtifact(artifact: any): Promise<void> {
    console.log(`[${this.type}] Art assets created:`, artifact);
    // Artifact path is already set in the save_asset_spec tool
  }
}
