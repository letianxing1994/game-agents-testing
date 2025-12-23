// Agent configuration types

export interface AgentSkill {
  name: string;
  description: string;
  type: 'plugin' | 'mcp' | 'tool';
  config?: Record<string, any>;
}

export interface AgentConfig {
  // Agent basic info
  id: string;
  type: string;
  label: string;

  // Agent configuration (editable in UI)
  scenario: string; // Required - describes when task is complete and determines completion criteria
  prompt?: string; // Optional - main system prompt for the agent
  suggestedQuestions?: string; // Optional - suggested questions for user in interactive mode
  workflow?: any; // Optional - custom workflow configuration
  skills?: AgentSkill[]; // Optional - additional tools/plugins/MCP servers

  // Runtime state
  status?: string;
  position?: { x: number; y: number };
}

export interface AgentExecutionMode {
  mode: 'automatic' | 'interactive';

  // For interactive mode
  waitingForUser?: boolean;
  currentQuestion?: string;
  artifactForApproval?: any;
  requiresApproval?: boolean;
}

export interface WorkflowExecutionState {
  currentNodeId: string | null;
  currentAgentType: string | null;
  mode: 'automatic' | 'interactive';
  blockedAgents: string[]; // Agents waiting for user input
  completedNodes: string[];
  artifactApprovals: Record<string, boolean>; // agentType -> approved
}
