import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import WebSocket from 'ws';

// Load environment variables from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { A2AServer } from './a2a/a2a-server.js';
import { LLMFactory } from './llm/index.js';
import { PersistenceManager } from './storage/persistence.js';
import { PlannerAgent } from './agents/planner-agent.js';
import { ArtistAgent } from './agents/artist-agent.js';
import { DeveloperAgent } from './agents/developer-agent.js';
import { AgentType, AgentConnection, MessageType } from './a2a/message-types.js';
import { Workflow } from './workflow/workflow-types.js';
import { AgentConfig, WorkflowExecutionState } from './types/agent-config.js';

// Load environment variables
const PORT = parseInt(process.env.PORT || '3000');
const WS_PORT = parseInt(process.env.WS_PORT || '3001');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Validate environment variables
console.log('=== Environment Variables ===');
console.log(`PORT: ${PORT}`);
console.log(`WS_PORT: ${WS_PORT}`);
console.log(`DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY ? '✓ Set (length: ' + DEEPSEEK_API_KEY.length + ')' : '✗ Not set'}`);
console.log(`GEMINI_API_KEY: ${GEMINI_API_KEY ? '✓ Set (length: ' + GEMINI_API_KEY.length + ')' : '✗ Not set'}`);
console.log('============================\n');

if (!DEEPSEEK_API_KEY || !GEMINI_API_KEY) {
  console.error('WARNING: API keys not configured! Please set DEEPSEEK_API_KEY and GEMINI_API_KEY in .env file');
  console.error('Copy .env.example to .env and fill in your API keys.\n');
}

// Initialize services
const app = express();
app.use(cors());
app.use(express.json());

const a2aServer = new A2AServer(WS_PORT);
const persistenceManager = new PersistenceManager();

// Initialize LLM clients
if (DEEPSEEK_API_KEY && GEMINI_API_KEY) {
  LLMFactory.initializeClients(DEEPSEEK_API_KEY, GEMINI_API_KEY);
  console.log('✓ LLM clients initialized successfully\n');
}

// Agent instances
let plannerAgent: PlannerAgent | null = null;
let artistAgent: ArtistAgent | null = null;
let developerAgent: DeveloperAgent | null = null;

// Agent connections configuration
let agentConnections: AgentConnection[] = [];

// Workflow execution state
let executionState: WorkflowExecutionState = {
  currentNodeId: null,
  currentAgentType: null,
  mode: 'automatic',
  blockedAgents: [],
  completedNodes: [],
  artifactApprovals: {},
};

// WebSocket client for monitoring A2A messages
let a2aMonitorClient: WebSocket | null = null;

// Setup A2A message monitor to auto-start next agents
function setupA2AMonitor() {
  a2aMonitorClient = new WebSocket(`ws://localhost:${WS_PORT}`);

  a2aMonitorClient.on('open', () => {
    console.log('[Server] Connected to A2A server for monitoring');
    a2aMonitorClient!.send(JSON.stringify({ type: 'register', agentType: 'server-monitor' }));
  });

  a2aMonitorClient.on('message', async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'a2a_message' && message.payload.type === MessageType.AGENT_COMPLETE) {
        const completedAgentType = message.payload.from;
        console.log(`\n[Server] Agent ${completedAgentType} completed, checking for next agents...`);

        // Mark agent as completed
        if (!executionState.completedNodes.includes(completedAgentType)) {
          executionState.completedNodes.push(completedAgentType);
          await persistenceManager.saveExecutionState(executionState);
        }

        // Find agents that depend on this completed agent
        const nextAgents = agentConnections
          .filter(conn => conn.from === completedAgentType)
          .map(conn => conn.to);

        console.log(`[Server] Next agents to check: ${nextAgents.join(', ')}`);

        // Start next agents if all their dependencies are met
        for (const nextAgentType of nextAgents) {
          // Check if all dependencies for this agent are completed
          const dependencies = agentConnections
            .filter(conn => conn.to === nextAgentType)
            .map(conn => conn.from);

          const allDependenciesCompleted = dependencies.every(dep =>
            executionState.completedNodes.includes(dep)
          );

          console.log(`[Server] Agent ${nextAgentType} dependencies: ${dependencies.join(', ')}`);
          console.log(`[Server] All dependencies completed: ${allDependenciesCompleted}`);

          if (allDependenciesCompleted) {
            const agent = getAgentByType(nextAgentType as AgentType);
            if (agent && agent.getStatus() === 'idle') {
              console.log(`[Server] Starting next agent: ${nextAgentType}`);
              executionState.currentAgentType = nextAgentType;
              await persistenceManager.saveExecutionState(executionState);
              await agent.start({}, executionState.mode as 'automatic' | 'interactive');
            }
          } else {
            console.log(`[Server] Agent ${nextAgentType} waiting for dependencies`);
          }
        }
      }
    } catch (error) {
      console.error('[Server] Failed to process A2A message:', error);
    }
  });

  a2aMonitorClient.on('error', (error) => {
    console.error('[Server] A2A monitor error:', error);
  });
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Initialize agents
app.post('/api/agents/initialize', async (req, res) => {
  try {
    const a2aUrl = `ws://localhost:${WS_PORT}`;

    plannerAgent = new PlannerAgent(
      LLMFactory.getDeepSeekClient(),
      persistenceManager,
      a2aUrl
    );

    artistAgent = new ArtistAgent(
      LLMFactory.getGeminiClient(),
      persistenceManager,
      a2aUrl
    );

    developerAgent = new DeveloperAgent(
      LLMFactory.getGeminiClient(),
      persistenceManager,
      a2aUrl
    );

    // Connect all agents to A2A server
    await Promise.all([
      plannerAgent.connectToA2A(),
      artistAgent.connectToA2A(),
      developerAgent.connectToA2A(),
    ]);

    // Setup server monitor to listen for agent completion and auto-start next agents
    if (!a2aMonitorClient) {
      setupA2AMonitor();
    }

    res.json({ success: true, message: 'Agents initialized successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Set agent connections
app.post('/api/agents/connections', (req, res) => {
  try {
    const { connections } = req.body;
    agentConnections = connections;

    // Set up A2A message handlers based on connections
    for (const conn of connections) {
      console.log(`Connection: ${conn.from} -> ${conn.to}`);
    }

    res.json({ success: true, connections: agentConnections });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent connections
app.get('/api/agents/connections', (req, res) => {
  res.json({ connections: agentConnections });
});

// Start specific agent
app.post('/api/agents/:type/start', async (req, res) => {
  try {
    const { type } = req.params;
    const { initialData } = req.body;

    const agent = getAgentByType(type as AgentType);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    await agent.start(initialData);
    res.json({ success: true, message: `${type} agent started` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Send message to agent
app.post('/api/agents/:type/message', async (req, res) => {
  try {
    const { type } = req.params;
    const { message } = req.body;

    const agent = getAgentByType(type as AgentType);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    await agent.sendUserMessage(message);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent status
app.get('/api/agents/:type/status', (req, res) => {
  try {
    const { type } = req.params;
    const agent = getAgentByType(type as AgentType);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    res.json({ status: agent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Pause agent
app.post('/api/agents/:type/pause', async (req, res) => {
  try {
    const { type } = req.params;
    const agent = getAgentByType(type as AgentType);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    await agent.pause();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Resume agent
app.post('/api/agents/:type/resume', async (req, res) => {
  try {
    const { type } = req.params;
    const agent = getAgentByType(type as AgentType);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    await agent.resume();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stop agent
app.post('/api/agents/:type/stop', async (req, res) => {
  try {
    const { type } = req.params;
    const agent = getAgentByType(type as AgentType);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    await agent.stop();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Set workflow for agent
app.post('/api/agents/:type/workflow', async (req, res) => {
  try {
    const { type } = req.params;
    const { workflow } = req.body as { workflow: Workflow };

    const agent = getAgentByType(type as AgentType);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found or not initialized' });
    }

    await agent.setWorkflow(workflow);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get workflow for agent
app.get('/api/agents/:type/workflow', async (req, res) => {
  try {
    const { type } = req.params;
    const workflow = await persistenceManager.readWorkflow(type);

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    res.json({ workflow });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List files
app.get('/api/files/:directory', async (req, res) => {
  try {
    const { directory } = req.params;
    const files = await persistenceManager.listFiles(directory as any);
    res.json({ files });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Read file
app.get('/api/files/:directory/:filename', async (req, res) => {
  try {
    const { directory, filename } = req.params;

    let content: string;
    if (directory === 'gdd') {
      content = await persistenceManager.readGDD(filename);
    } else if (directory === 'code') {
      content = await persistenceManager.readCode(filename);
    } else if (directory === 'assets') {
      const buffer = await persistenceManager.readAsset(filename);
      content = buffer.toString();
    } else {
      return res.status(400).json({ error: 'Invalid directory' });
    }

    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Save agent configuration
app.post('/api/agents/:type/config', async (req, res) => {
  try {
    const { type } = req.params;
    const config: AgentConfig = req.body;

    console.log(`Saving config for ${type}:`, JSON.stringify(config, null, 2));
    await persistenceManager.saveAgentConfig(type, config);
    console.log(`Config saved successfully for ${type}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`Failed to save config for ${type}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get agent configuration
app.get('/api/agents/:type/config', async (req, res) => {
  try {
    const { type } = req.params;
    const config = await persistenceManager.readAgentConfig(type);

    console.log(`Reading config for ${type}:`, config ? 'Found' : 'Not found');
    if (config) {
      console.log(`Config scenario: ${config.scenario}`);
    }

    if (!config) {
      // Return default config
      console.log(`Returning default config for ${type}`);
      return res.json({
        id: type,
        type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        scenario: '',
        prompt: '',
        suggestedQuestions: '',
        workflow: null,
        skills: [],
      });
    }

    res.json(config);
  } catch (error: any) {
    console.error(`Failed to read config for ${type}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get execution state
app.get('/api/execution/state', async (req, res) => {
  try {
    const savedState = await persistenceManager.readExecutionState();
    res.json(savedState || executionState);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update execution state
app.post('/api/execution/state', async (req, res) => {
  try {
    executionState = { ...executionState, ...req.body };
    await persistenceManager.saveExecutionState(executionState);
    res.json({ success: true, state: executionState });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start workflow (method 1: automatic)
app.post('/api/workflow/start', async (req, res) => {
  try {
    const { mode } = req.body; // 'automatic' or 'interactive'
    console.log(`\n=== Starting workflow in ${mode} mode ===`);

    executionState = {
      currentNodeId: null,
      currentAgentType: null,
      mode: mode || 'automatic',
      blockedAgents: [],
      completedNodes: [],
      artifactApprovals: {},
    };

    await persistenceManager.saveExecutionState(executionState);

    // Find agents with no dependencies (no incoming edges)
    const allAgents = ['planner', 'artist', 'developer'];
    const agentsWithDependencies = agentConnections.map(conn => conn.to);
    const startingAgents = allAgents.filter(agent => !agentsWithDependencies.includes(agent));

    console.log(`All agent connections:`, JSON.stringify(agentConnections));
    console.log(`All agents: ${allAgents.join(', ')}`);
    console.log(`Agents with dependencies: ${agentsWithDependencies.join(', ')}`);
    console.log(`Starting agents (no dependencies): ${startingAgents.join(', ')}`);
    console.log(`Starting ONLY these agents: ${JSON.stringify(startingAgents)}`);

    if (startingAgents.length === 0) {
      console.error('No starting agents found (all agents have dependencies - possible circular dependency)');
      res.status(400).json({ error: 'No starting agents found' });
      return;
    }

    // Start ONLY agents with no dependencies
    for (const agentType of startingAgents) {
      const agent = getAgentByType(agentType as AgentType);
      if (agent) {
        console.log(`>>> STARTING AGENT: ${agentType} <<<`);
        await agent.start({}, mode as 'automatic' | 'interactive');
        console.log(`>>> Agent ${agentType} started successfully <<<`);
      } else {
        console.error(`Agent ${agentType} not found or not initialized`);
      }
    }

    console.log(`Workflow start completed. Should have started: ${startingAgents.join(', ')}`);

    executionState.currentAgentType = startingAgents[0]; // Set first as current
    await persistenceManager.saveExecutionState(executionState);

    res.json({
      success: true,
      message: `Workflow started in ${mode} mode`,
      currentAgent: startingAgents[0],
      startedAgents: startingAgents,
    });
  } catch (error: any) {
    console.error('Error starting workflow:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Send user response in interactive mode
app.post('/api/workflow/respond', async (req, res) => {
  try {
    const { agentType, message, approveArtifact } = req.body;

    const agent = getAgentByType(agentType as AgentType);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Send message to agent
    if (message) {
      await agent.sendUserMessage(message);
      res.json({ success: true, message: 'Message sent to agent' });
      return;
    }

    // Handle artifact approval
    if (approveArtifact !== undefined) {
      await (agent as any).approveArtifact(approveArtifact);
      executionState.artifactApprovals[agentType] = approveArtifact;

      if (approveArtifact) {
        // Move to next agent
        executionState.completedNodes.push(agentType);

        const sortedAgents = topologicalSort();
        const currentIndex = sortedAgents.indexOf(agentType);
        if (currentIndex >= 0 && currentIndex < sortedAgents.length - 1) {
          const nextAgent = sortedAgents[currentIndex + 1];
          executionState.currentAgentType = nextAgent;

          // Start next agent in interactive mode
          const nextAgentInstance = getAgentByType(nextAgent as AgentType);
          if (nextAgentInstance) {
            // Don't auto-start, wait for user to initiate conversation
            res.json({
              success: true,
              message: 'Moving to next agent',
              nextAgent,
            });
          } else {
            res.status(404).json({ error: 'Next agent not found' });
          }
        } else {
          // Workflow completed
          executionState.currentAgentType = null;
          res.json({ success: true, message: 'Workflow completed' });
        }
      } else {
        // User rejected artifact, agent will continue iterating
        res.json({ success: true, message: 'Agent will continue iterating' });
      }

      await persistenceManager.saveExecutionState(executionState);
    } else {
      res.json({ success: true, message: 'No action specified' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent state (question, artifact, etc.)
app.get('/api/agents/:type/state', (req, res) => {
  try {
    const { type } = req.params;
    const agent = getAgentByType(type as AgentType) as any;

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({
      status: agent.getStatus(),
      currentQuestion: agent.getCurrentQuestion ? agent.getCurrentQuestion() : null,
      artifactForApproval: agent.getArtifactForApproval ? agent.getArtifactForApproval() : null,
      executionContext: agent.executionContext || {},
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function topologicalSort(): string[] {
  const inDegree: Record<string, number> = { planner: 0, artist: 0, developer: 0 };
  const graph: Record<string, string[]> = { planner: [], artist: [], developer: [] };

  agentConnections.forEach((edge: AgentConnection) => {
    if (!graph[edge.from]) graph[edge.from] = [];
    graph[edge.from].push(edge.to);
    inDegree[edge.to] = (inDegree[edge.to] || 0) + 1;
  });

  const queue: string[] = [];
  const result: string[] = [];

  Object.keys(inDegree).forEach((node) => {
    if (inDegree[node] === 0) {
      queue.push(node);
    }
  });

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    if (graph[node]) {
      graph[node].forEach((neighbor) => {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      });
    }
  }

  return result;
}

// Helper function to get agent by type
function getAgentByType(type: AgentType) {
  switch (type) {
    case AgentType.PLANNER:
      return plannerAgent;
    case AgentType.ARTIST:
      return artistAgent;
    case AgentType.DEVELOPER:
      return developerAgent;
    default:
      return null;
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`API Server running on port ${PORT}`);
  console.log(`A2A Server running on port ${WS_PORT}`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  POST /api/agents/initialize - Initialize all agents`);
  console.log(`  POST /api/agents/connections - Set agent connections`);
  console.log(`  POST /api/agents/:type/start - Start an agent`);
  console.log(`  POST /api/agents/:type/message - Send message to agent`);
  console.log(`  GET  /api/agents/:type/status - Get agent status`);
  console.log(`  POST /api/agents/:type/workflow - Set agent workflow`);
  console.log(`  GET  /api/files/:directory - List files`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  plannerAgent?.disconnect();
  artistAgent?.disconnect();
  developerAgent?.disconnect();
  if (a2aMonitorClient) {
    a2aMonitorClient.close();
  }
  process.exit(0);
});
