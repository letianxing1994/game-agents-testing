/**
 * Workflow Types and Definitions
 */

export enum WorkflowNodeType {
  TOOL_CALL = 'tool_call',
  DATA_ACCESS = 'data_access',
  REACT = 'react',
  CONDITION = 'condition',
  LOOP = 'loop',
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: {
    toolName?: string;
    toolParams?: Record<string, any>;
    dataSource?: string;
    condition?: string;
    maxIterations?: number;
    reactPrompt?: string;
  };
  next?: string | string[]; // Next node ID(s)
}

export interface Workflow {
  id: string;
  name: string;
  agentType: string;
  nodes: WorkflowNode[];
  startNode: string;
  goalCondition: string; // Condition to exit the loop
}

export interface WorkflowExecutionContext {
  variables: Record<string, any>;
  iteration: number;
  history: any[];
  userMessages: string[];
  previousArtifacts: Record<string, string>; // Artifacts from previous agents
}

export interface WorkflowExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  context: WorkflowExecutionContext;
}
