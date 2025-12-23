import { BaseAgent } from './base-agent.js';
import { AgentType } from '../a2a/message-types.js';
import { BaseLLMClient } from '../llm/base-llm-client.js';
import { PersistenceManager } from '../storage/persistence.js';
import { Tool } from '../workflow/react-executor.js';

/**
 * Game Developer Agent
 * Responsible for creating playable game code
 * Uses Gemini 2.0 Flash model
 */
export class DeveloperAgent extends BaseAgent {
  constructor(
    llmClient: BaseLLMClient,
    persistenceManager: PersistenceManager,
    a2aServerUrl: string
  ) {
    super(AgentType.DEVELOPER, llmClient, persistenceManager, a2aServerUrl);
  }

  protected initializeTools(): void {
    this.tools = [
      {
        name: 'save_code',
        description: 'Save game code to file',
        parameters: {
          filename: 'string',
          content: 'string',
        },
        execute: async (params: any, context: any) => {
          const path = await this.persistenceManager.saveCode(params.filename, params.content);
          if (params.filename === 'index.html' || params.filename.endsWith('.html')) {
            context.variables.artifactPath = path;
          }
          return { success: true, path };
        },
      },
      {
        name: 'read_code',
        description: 'Read existing code file',
        parameters: {
          filename: 'string',
        },
        execute: async (params: any) => {
          const content = await this.persistenceManager.readCode(params.filename);
          return { content };
        },
      },
      {
        name: 'read_gdd',
        description: 'Read the Game Design Document',
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
        name: 'read_assets',
        description: 'Read asset specifications from artist',
        parameters: {
          path: 'string',
        },
        execute: async (params: any) => {
          const content = await this.persistenceManager.readAsset(
            params.path.split('/').pop()
          );
          return { content: content.toString() };
        },
      },
      {
        name: 'generate_game_code',
        description: 'Use LLM to generate game code based on requirements',
        parameters: {
          requirements: 'string',
          fileType: 'string', // 'html', 'js', 'ts', etc.
        },
        execute: async (params: any) => {
          const response = await this.llmClient.chat([
            {
              role: 'system',
              content: `You are an expert game developer specializing in web-based games using TypeScript, JavaScript, and WebGL.

Generate clean, working code that can run in a browser. Include all necessary HTML, CSS, and JavaScript in a single file when creating HTML files.`,
            },
            {
              role: 'user',
              content: `Generate ${params.fileType} code for:\n\n${params.requirements}\n\nProvide only the code, no explanations.`,
            },
          ]);
          return { code: response.content };
        },
      },
      {
        name: 'list_code_files',
        description: 'List all code files',
        parameters: {},
        execute: async () => {
          const files = await this.persistenceManager.listFiles('code');
          return { files };
        },
      },
    ];
  }

  protected getDefaultGoal(): string {
    return `Create a complete, playable browser-based game.

Tasks:
1. Read the GDD from the planner agent (if available)
2. Read the asset specifications from the artist agent (if available)
3. Design the game architecture
4. Implement core game mechanics
5. Integrate art assets
6. Create the main HTML file with embedded JavaScript/TypeScript
7. Ensure the game is playable in a browser
8. Test and debug

The final output should be a working game that can be opened in a browser.

Programming languages: TypeScript, JavaScript, WebGL
Output format: HTML file with embedded scripts, or separate files

Save all code files using the save_code tool. Make sure to save the main HTML file last.`;
  }

  protected getSystemPrompt(): string {
    return `You are an expert game developer specializing in web-based games.

Your role is to:
- Implement game mechanics based on the GDD
- Integrate art assets from the Artist Agent
- Write clean, efficient TypeScript/JavaScript code
- Create games that run smoothly in modern browsers
- Use Canvas API or WebGL for rendering
- Handle user input and game state
- Implement game loop and physics

You work closely with:
- Planner Agent (provides GDD)
- Artist Agent (provides visual assets)

Technical stack:
- TypeScript or JavaScript
- HTML5 Canvas or WebGL
- No external frameworks required (vanilla JS is fine)
- All code should work in modern browsers

Use the available tools to access the GDD and assets, and to save your code.`;
  }

  protected async processArtifact(artifact: any): Promise<void> {
    console.log(`[${this.type}] Game code created:`, artifact);
    // Artifact path is already set in the save_code tool
  }
}
