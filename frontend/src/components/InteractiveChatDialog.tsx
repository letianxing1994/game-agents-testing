import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './InteractiveChatDialog.css';

interface InteractiveChatDialogProps {
  onClose: () => void;
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

function InteractiveChatDialog({ onClose }: InteractiveChatDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [executionState, setExecutionState] = useState<any>(null);
  const [lastHistoryLength, setLastHistoryLength] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(updateState, 2000);
    return () => clearInterval(interval);
  }, [currentAgent]);

  const updateState = async () => {
    try {
      // Get execution state
      const execRes = await axios.get('/api/execution/state');
      setExecutionState(execRes.data);

      if (execRes.data && execRes.data.currentAgentType) {
        setCurrentAgent(execRes.data.currentAgentType);

        // Get agent state
        const agentRes = await axios.get(
          `/api/agents/${execRes.data.currentAgentType}/state`
        );
        setAgentState(agentRes.data);

        // Display ReAct execution steps
        if (agentRes.data.executionContext?.history) {
          const history = agentRes.data.executionContext.history;
          if (history.length > lastHistoryLength) {
            // New steps available
            for (let i = lastHistoryLength; i < history.length; i++) {
              const step = history[i];

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
            }
            setLastHistoryLength(history.length);
          }
        }

        // Auto-show question if agent is waiting
        if (
          agentRes.data.currentQuestion &&
          messages[messages.length - 1]?.content !== agentRes.data.currentQuestion
        ) {
          addSystemMessage(agentRes.data.currentQuestion);
        }

        // Auto-show artifact approval request
        if (
          agentRes.data.artifactForApproval &&
          messages[messages.length - 1]?.role !== 'system'
        ) {
          addSystemMessage(
            'Task completed! Please review the artifact and approve or provide feedback.'
          );
        }
      }
    } catch (error) {
      // Ignore errors during state update
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

    try {
      await axios.post('/api/workflow/respond', {
        agentType: currentAgent,
        message: input,
      });

      addSystemMessage('Message received. Agent is processing...');
    } catch (error) {
      console.error('Failed to send message:', error);
      addSystemMessage('Error: Failed to send message to agent.');
    } finally {
      setSending(false);
    }
  };

  const handleApprove = async (approved: boolean) => {
    if (!currentAgent) return;

    setSending(true);
    try {
      const response = await axios.post('/api/workflow/respond', {
        agentType: currentAgent,
        approveArtifact: approved,
      });

      if (approved) {
        if (response.data.nextAgent) {
          addSystemMessage(
            `Artifact approved! Moving to ${response.data.nextAgent} agent.`
          );
          setCurrentAgent(response.data.nextAgent);
          setLastHistoryLength(0); // Reset history for new agent
        } else {
          addSystemMessage('Workflow completed! All agents have finished.');
          setCurrentAgent(null);
        }
      } else {
        addSystemMessage('Artifact rejected. Agent will continue working...');
        setLastHistoryLength(0); // Reset to see new iterations
      }
    } catch (error) {
      console.error('Failed to approve artifact:', error);
      addSystemMessage('Error: Failed to process approval.');
    } finally {
      setSending(false);
    }
  };

  const handleStart = async () => {
    setSending(true);
    try {
      // First ensure agents are initialized
      try {
        await axios.post('/api/agents/initialize');
        console.log('Agents initialized');
      } catch (initError) {
        console.log('Agents may already be initialized');
      }

      const response = await axios.post('/api/workflow/start', {
        mode: 'interactive',
      });

      setCurrentAgent(response.data.currentAgent);
      addSystemMessage(
        `Starting interactive workflow with ${response.data.currentAgent} agent. Please provide your initial requirements.`
      );
      setLastHistoryLength(0); // Reset history tracking
    } catch (error) {
      console.error('Failed to start workflow:', error);
      addSystemMessage('Error: Failed to start workflow.');
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
        <div style={{ fontSize: '10px', padding: '5px', background: '#f0f0f0' }}>
          Debug: currentAgent={currentAgent}, status={agentState?.status},
          hasArtifact={!!agentState?.artifactForApproval}
        </div>
      )}
    </div>
  );
}

export default InteractiveChatDialog;
