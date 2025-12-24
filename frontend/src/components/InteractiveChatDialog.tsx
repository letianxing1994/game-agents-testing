import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './InteractiveChatDialog.css';

interface InteractiveChatDialogProps {
  onClose: () => void;
  edges: any[]; // ReactFlow edges
}

interface Message {
  role: 'user' | 'agent' | 'system' | 'thought' | 'action' | 'observation';
  content: string;
  timestamp: number;
  actionName?: string;
}

interface AgentState {
  status: string;
  currentQuestion: string | null;
  artifactForApproval: any;
  executionContext?: {
    iteration: number;
    history: Array<{
      thought: string;
      action: string;
      actionInput: any;
      observation: string;
    }>;
  };
}

function InteractiveChatDialog({ onClose, edges }: InteractiveChatDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [executionState, setExecutionState] = useState<any>(null);
  const [lastHistoryLength, setLastHistoryLength] = useState(0);
  const [artifactApprovalShown, setArtifactApprovalShown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    console.log('[InteractiveChat] Connecting to WebSocket...');
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[InteractiveChat] WebSocket connected');
      // Register as frontend client
      ws.send(JSON.stringify({ type: 'register', agentType: 'frontend-ui' }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[InteractiveChat] WebSocket message:', message);

        // Handle A2A messages
        if (message.type === 'a2a_message') {
          handleA2AMessage(message.payload);
        }
      } catch (error) {
        console.error('[InteractiveChat] WebSocket message error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[InteractiveChat] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[InteractiveChat] WebSocket disconnected');
    };

    return () => {
      console.log('[InteractiveChat] Closing WebSocket');
      ws.close();
    };
  }, []);

  const handleA2AMessage = (a2aMessage: any) => {
    console.log('[InteractiveChat] A2A message from:', a2aMessage.from, 'type:', a2aMessage.type);
    console.log('[InteractiveChat] Full A2A message:', JSON.stringify(a2aMessage, null, 2));

    // Handle different message types
    switch (a2aMessage.type) {
      case 'agent_progress':
        // Check if this is an artifact approval request
        if (a2aMessage.payload?.data?.status === 'waiting_for_approval' && a2aMessage.payload?.data?.artifact) {
          console.log('[InteractiveChat] Artifact approval request received!');

          // Update agent state to show artifact
          setAgentState({
            status: 'waiting_for_approval',
            currentQuestion: null,
            artifactForApproval: a2aMessage.payload.data.artifact,
            executionContext: undefined,
          });

          // Show system message
          if (!artifactApprovalShown) {
            addSystemMessage('Task completed! Please review the artifact and approve or provide feedback.');
            setArtifactApprovalShown(true);
          }
          break;
        }

        // Real-time ReAct step update
        if (a2aMessage.payload?.data?.step) {
          const step = a2aMessage.payload.data.step;
          console.log('[InteractiveChat] Real-time ReAct step received!');
          console.log('[InteractiveChat] Thought:', step.thought.substring(0, 100));
          console.log('[InteractiveChat] Action:', step.action);

          // Add thought
          addAgentMessage(`💭 Thought: ${step.thought}`);

          // Add action
          const actionText = step.action === 'FINISH'
            ? '✅ Action: FINISH - Task completed'
            : `🔧 Action: ${step.action}${step.actionInput ? `\nInput: ${JSON.stringify(step.actionInput)}` : ''}`;
          addAgentMessage(actionText);

          // Add observation
          if (step.observation) {
            addAgentMessage(`📊 Observation: ${step.observation}`);
          }

          // Update history length
          if (a2aMessage.payload.data.historyLength) {
            setLastHistoryLength(a2aMessage.payload.data.historyLength);
          }
        } else {
          console.log('[InteractiveChat] No step data in agent_progress message');
          console.log('[InteractiveChat] Message payload:', a2aMessage.payload);
        }

        // Update agent status from progress message
        if (a2aMessage.payload?.data?.status) {
          console.log('[InteractiveChat] Updating agent state status:', a2aMessage.payload.data.status);
          setAgentState((prev) => ({
            ...prev,
            status: a2aMessage.payload.data.status,
          }));
        }
        break;

      case 'agent_complete':
        console.log('[InteractiveChat] Agent completed:', a2aMessage.from);
        addSystemMessage(`${a2aMessage.from} agent completed successfully!`);

        // Clear artifact approval flag for next agent
        setArtifactApprovalShown(false);

        // Update state to check for next agent
        updateState();
        break;

      case 'agent_start':
        console.log('[InteractiveChat] Agent started:', a2aMessage.from);
        // Update current agent if it's different
        if (a2aMessage.from !== currentAgent) {
          console.log('[InteractiveChat] Switching to new agent:', a2aMessage.from);
          setCurrentAgent(a2aMessage.from);
          setLastHistoryLength(0); // Reset history for new agent
          setArtifactApprovalShown(false); // Reset approval flag
          addSystemMessage(`${a2aMessage.from} agent started. Provide your requirements.`);
        }
        break;

      default:
        console.log('[InteractiveChat] Unknown message type:', a2aMessage.type);
    }
  };

  const updateState = async () => {
    if (!currentAgent) {
      console.log('[InteractiveChat] No current agent, skipping state update');
      return;
    }

    try {
      console.log('[InteractiveChat] Fetching state for agent:', currentAgent);

      // Get execution state
      const execRes = await axios.get('/api/execution/state');
      setExecutionState(execRes.data);

      if (execRes.data && execRes.data.currentAgentType) {
        setCurrentAgent(execRes.data.currentAgentType);

        // Get agent state (mainly for artifact approval)
        const agentRes = await axios.get(
          `/api/agents/${execRes.data.currentAgentType}/state`
        );
        setAgentState(agentRes.data);

        // Auto-show artifact approval request (only once)
        if (agentRes.data.artifactForApproval && !artifactApprovalShown) {
          addSystemMessage(
            'Task completed! Please review the artifact and approve or provide feedback.'
          );
          setArtifactApprovalShown(true);
        }

        // Reset flag when artifact is cleared
        if (!agentRes.data.artifactForApproval && artifactApprovalShown) {
          setArtifactApprovalShown(false);
        }
      }
    } catch (error) {
      console.error('[InteractiveChat] State update error:', error);
    }
  };

  const addSystemMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { role: 'system', content, timestamp: Date.now() },
    ]);
  };

  const addAgentMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { role: 'agent', content, timestamp: Date.now() },
    ]);
  };

  const handleSend = async () => {
    if (!input.trim() || sending || !currentAgent) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);

    // Reset history tracking when user sends new message
    setLastHistoryLength(0);

    try {
      // Send message via WebSocket instead of HTTP
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'a2a_message',
            payload: {
              type: 'user_message',
              from: 'user',
              to: currentAgent,
              payload: { content: input },
            },
          })
        );
        addSystemMessage('Message sent. Agent is processing...');
      } else {
        // Fallback to HTTP if WebSocket not available
        await axios.post('/api/workflow/respond', {
          agentType: currentAgent,
          message: input,
        });
        addSystemMessage('Message received. Agent is processing...');
      }

      // Check for updates after sending message
      setTimeout(() => updateState(), 100);
    } catch (error) {
      console.error('Failed to send message:', error);
      addSystemMessage('Error: Failed to send message to agent.');
    } finally {
      setSending(false);
    }
  };

  const handleApprove = async (approved: boolean) => {
    if (!currentAgent) return;

    console.log(`[InteractiveChat] User ${approved ? 'approved' : 'rejected'} artifact for ${currentAgent}`);
    setSending(true);
    setArtifactApprovalShown(false); // Reset flag when handling approval

    try {
      // Send approval via WebSocket instead of HTTP
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log(`[InteractiveChat] Sending approval via WebSocket: ${approved}`);
        wsRef.current.send(
          JSON.stringify({
            type: 'a2a_message',
            payload: {
              type: 'artifact_approval',
              from: 'user',
              to: currentAgent,
              payload: {
                data: { approved },
              },
            },
          })
        );

        // Clear artifact from state immediately
        setAgentState((prev) => ({
          ...prev,
          artifactForApproval: null,
        }));

        if (approved) {
          addSystemMessage('Artifact approved! Agent will complete and next agent will start automatically.');
        } else {
          addSystemMessage('Artifact rejected. Agent will continue working...');
          setLastHistoryLength(0); // Reset to see new iterations
        }
      } else {
        console.error('[InteractiveChat] WebSocket not available, cannot send approval');
        addSystemMessage('Error: WebSocket connection lost. Cannot send approval.');
      }
    } catch (error) {
      console.error('Failed to approve artifact:', error);
      addSystemMessage('Error: Failed to process approval.');
    } finally {
      setSending(false);
    }
  };

  const handleStart = async () => {
    console.log('[InteractiveChat] handleStart called');
    setSending(true);
    try {
      // First ensure agents are initialized
      try {
        await axios.post('/api/agents/initialize');
        console.log('[InteractiveChat] Agents initialized');
      } catch (initError) {
        console.log('[InteractiveChat] Agents may already be initialized:', initError);
      }

      // IMPORTANT: Send connections to backend before starting workflow
      console.log('[InteractiveChat] Sending agent connections:', edges);
      const connections = edges.map((edge) => ({
        from: edge.source,
        to: edge.target,
      }));
      try {
        await axios.post('/api/agents/connections', { connections });
        console.log('[InteractiveChat] Connections updated successfully');
      } catch (connError) {
        console.error('[InteractiveChat] Failed to update connections:', connError);
        addSystemMessage('Error: Failed to update agent connections.');
        setSending(false);
        return;
      }

      console.log('[InteractiveChat] Calling /api/workflow/start...');
      const response = await axios.post('/api/workflow/start', {
        mode: 'interactive',
      });
      console.log('[InteractiveChat] Workflow start response:', response.data);

      const agentType = response.data.currentAgent;
      console.log('[InteractiveChat] Setting currentAgent to:', agentType);
      setCurrentAgent(agentType);

      // Immediately fetch agent state to ensure input box shows up
      try {
        console.log('[InteractiveChat] Fetching agent state for:', agentType);
        const agentRes = await axios.get(`/api/agents/${agentType}/state`);
        console.log('[InteractiveChat] Agent state:', agentRes.data);
        setAgentState(agentRes.data);
      } catch (stateError) {
        console.error('[InteractiveChat] Failed to fetch agent state:', stateError);
      }

      console.log('[InteractiveChat] Adding system message');
      addSystemMessage(
        `Starting interactive workflow with ${agentType} agent. Please provide your initial requirements.`
      );
      setLastHistoryLength(0); // Reset history tracking
      console.log('[InteractiveChat] handleStart completed successfully');
    } catch (error) {
      console.error('[InteractiveChat] Failed to start workflow:', error);
      addSystemMessage('Error: Failed to start workflow. Check console for details.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      idle: '#666',
      running: '#4CAF50',
      waiting_for_user: '#9C27B0',
      waiting_for_approval: '#FF5722',
      completed: '#2196F3',
      error: '#f44336',
    };
    return colors[status] || '#666';
  };

  return (
    <div className="interactive-chat-dialog">
      <div className="interactive-chat-header">
        <h3>预览与调试</h3>
        {currentAgent && (
          <div className="current-agent-indicator">
            <span
              className="status-dot"
              style={{ background: getStatusColor(agentState?.status || 'idle') }}
            />
            <span className="agent-name">{currentAgent}</span>
          </div>
        )}
        <button className="close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="interactive-chat-messages">
        {messages.length === 0 && !currentAgent && (
          <div className="chat-empty">
            <p>Interactive debugging mode</p>
            <p>Start the workflow to begin interacting with agents.</p>
            <button className="btn-primary" onClick={handleStart}>
              Start Workflow
            </button>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.role}`}>
            <div className="message-header">
              <span className="message-role">
                {msg.role === 'system'
                  ? '系统'
                  : msg.role === 'agent'
                  ? currentAgent
                  : '用户'}
              </span>
              <span className="message-timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {agentState?.artifactForApproval && (
          <div className="artifact-approval">
            <h4>Artifact Preview</h4>
            <pre>{JSON.stringify(agentState.artifactForApproval, null, 2)}</pre>
            <div className="approval-actions">
              <button
                className="btn-approve"
                onClick={() => handleApprove(true)}
                disabled={sending}
              >
                ✓ Approve
              </button>
              <button
                className="btn-reject"
                onClick={() => handleApprove(false)}
                disabled={sending}
              >
                ✗ Reject
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {currentAgent && !agentState?.artifactForApproval && (
        <div className="interactive-chat-input-container">
          <textarea
            className="interactive-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              agentState?.currentQuestion ||
              agentState?.status === 'waiting_for_user'
                ? 'The agent is waiting for your response...'
                : 'Type your message to the agent...'
            }
            rows={3}
            disabled={sending}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim() || sending}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      )}

      {/* Debug info - remove in production */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{ fontSize: '10px', padding: '5px', background: '#f0f0f0', color: '#000' }}>
          Debug: currentAgent={currentAgent}, status={agentState?.status},
          hasArtifact={!!agentState?.artifactForApproval}, messages={messages.length},
          sending={sending}
        </div>
      )}
    </div>
  );
}

export default InteractiveChatDialog;
