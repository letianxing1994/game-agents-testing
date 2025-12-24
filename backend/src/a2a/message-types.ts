/**
 * A2A (Agent-to-Agent) Message Types
 */

export enum MessageType {
  AGENT_START = 'agent_start',
  AGENT_COMPLETE = 'agent_complete',
  AGENT_ERROR = 'agent_error',
  AGENT_PROGRESS = 'agent_progress',
  USER_MESSAGE = 'user_message',
  SYSTEM_MESSAGE = 'system_message',
  ARTIFACT_APPROVAL = 'artifact_approval',
}

export enum AgentType {
  PLANNER = 'planner',
  ARTIST = 'artist',
  DEVELOPER = 'developer',
}

export interface A2AMessage {
  id: string;
  type: MessageType;
  from: AgentType | 'user' | 'system';
  to: AgentType | 'all';
  timestamp: number;
  payload: {
    content?: string;
    data?: any;
    artifactPath?: string;
    error?: string;
  };
}

export interface AgentConnection {
  from: AgentType;
  to: AgentType;
}
