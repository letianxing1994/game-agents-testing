import React, { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';
import AgentNode from './components/AgentNode';
import ChatDialog from './components/ChatDialog';
import WorkflowEditor from './components/WorkflowEditor';
import InteractiveChatDialog from './components/InteractiveChatDialog';
import axios from 'axios';
import './App.css';

const nodeTypes = {
  agentNode: AgentNode,
};

interface AgentStatus {
  type: string;
  status: string;
}

const initialNodes: Node[] = [
  {
    id: 'planner',
    type: 'agentNode',
    position: { x: 100, y: 200 },
    data: { label: 'Game Planner', type: 'planner', status: 'idle' },
  },
  {
    id: 'artist',
    type: 'agentNode',
    position: { x: 400, y: 200 },
    data: { label: 'Game Artist', type: 'artist', status: 'idle' },
  },
  {
    id: 'developer',
    type: 'agentNode',
    position: { x: 700, y: 200 },
    data: { label: 'Game Developer', type: 'developer', status: 'idle' },
  },
];

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [initialized, setInitialized] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showWorkflowEditor, setShowWorkflowEditor] = useState(false);
  const [showInteractiveChat, setShowInteractiveChat] = useState(false);
  const [workflowAgent, setWorkflowAgent] = useState<string | null>(null);

  // Initialize agents on mount
  useEffect(() => {
    initializeAgents();
    const interval = setInterval(updateAgentStatuses, 2000);
    return () => clearInterval(interval);
  }, []);

  // Update agent connections when edges change
  useEffect(() => {
    if (initialized) {
      updateConnections();
    }
  }, [edges, initialized]);

  const initializeAgents = async () => {
    try {
      await axios.post('/api/agents/initialize');
      setInitialized(true);
      console.log('Agents initialized');
    } catch (error) {
      console.error('Failed to initialize agents:', error);
    }
  };

  const updateAgentStatuses = async () => {
    try {
      const statuses = await Promise.all([
        axios.get('/api/agents/planner/status'),
        axios.get('/api/agents/artist/status'),
        axios.get('/api/agents/developer/status'),
      ]);

      setNodes((nds) =>
        nds.map((node) => {
          const statusMap: Record<string, string> = {
            planner: statuses[0].data.status,
            artist: statuses[1].data.status,
            developer: statuses[2].data.status,
          };
          return {
            ...node,
            data: { ...node.data, status: statusMap[node.id] },
          };
        })
      );
    } catch (error) {
      // Ignore errors during status update
    }
  };

  const updateConnections = async () => {
    const connections = edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
    }));

    try {
      await axios.post('/api/agents/connections', { connections });
      console.log('Connections updated:', connections);
    } catch (error) {
      console.error('Failed to update connections:', error);
    }
  };

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleNodeClick = (event: React.MouseEvent, node: Node) => {
    const agentType = node.data.type;
    const status = node.data.status;

    if (status === 'running') {
      setSelectedAgent(agentType);
      setShowChat(true);
    }
  };

  const handleNodeDoubleClick = (event: React.MouseEvent, node: Node) => {
    setWorkflowAgent(node.data.type);
    setShowWorkflowEditor(true);
  };

  const handleStartAutomatic = async () => {
    if (edges.length === 0) {
      alert('Please connect agents first by dragging connections between them.');
      return;
    }

    // Validate all agents have required configuration
    const hasValidConfig = await validateAgentConfigs();
    if (!hasValidConfig) {
      alert(
        'Please configure all agents first. Each agent must have a scenario (适用场景) defined.'
      );
      return;
    }

    try {
      // Ensure agents are initialized before starting
      if (!initialized) {
        await initializeAgents();
      }

      await axios.post('/api/workflow/start', { mode: 'automatic' });
      console.log('Workflow started in automatic mode');
    } catch (error) {
      console.error('Failed to start workflow:', error);
      alert('Failed to start workflow. Please check the console for details.');
    }
  };

  const handleStartInteractive = () => {
    if (edges.length === 0) {
      alert('Please connect agents first by dragging connections between them.');
      return;
    }

    setShowInteractiveChat(true);
  };

  const validateAgentConfigs = async (): Promise<boolean> => {
    try {
      // Get all agent types that are connected in the workflow
      const connectedAgents = new Set<string>();
      edges.forEach((edge) => {
        connectedAgents.add(edge.source);
        connectedAgents.add(edge.target);
      });

      // Only validate agents that are part of the workflow
      const validationPromises = Array.from(connectedAgents).map((agentType) =>
        axios.get(`/api/agents/${agentType}/config`)
      );

      const configs = await Promise.all(validationPromises);

      return configs.every((res) => res.data.scenario && res.data.scenario.trim());
    } catch (error) {
      console.error('Failed to validate configs:', error);
      return false;
    }
  };

  return (
    <div className={`app ${showInteractiveChat ? 'with-chat' : ''}`}>
      <div className="header">
        <h1>Game Agents Testing - Multi-Agent System</h1>
        <div className="controls">
          <button
            onClick={handleStartInteractive}
            disabled={!initialized || edges.length === 0}
            className="btn btn-interactive"
            title="Start workflow in interactive mode with live debugging"
          >
            预览与调试
          </button>
          <button
            onClick={handleStartAutomatic}
            disabled={!initialized || edges.length === 0}
            className="btn btn-primary"
            title="Start workflow in automatic mode"
          >
            开始
          </button>
          <button
            onClick={initializeAgents}
            disabled={initialized}
            className="btn btn-secondary"
          >
            {initialized ? 'Initialized' : 'Initialize Agents'}
          </button>
        </div>
      </div>

      <div className="canvas-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <div className="instructions">
        <p>
          <strong>Instructions:</strong>
        </p>
        <ul>
          <li>Click the expand button (▶) on each agent to configure it</li>
          <li>Connect agents by dragging from one node to another</li>
          <li>Click "开始" to run workflow automatically</li>
          <li>Click "预览与调试" for interactive debugging mode</li>
          <li>Double-click an agent to edit its workflow</li>
        </ul>
      </div>

      {showChat && selectedAgent && (
        <ChatDialog agentType={selectedAgent} onClose={() => setShowChat(false)} />
      )}

      {showWorkflowEditor && workflowAgent && (
        <WorkflowEditor
          agentType={workflowAgent}
          onClose={() => setShowWorkflowEditor(false)}
        />
      )}

      {showInteractiveChat && (
        <InteractiveChatDialog onClose={() => setShowInteractiveChat(false)} />
      )}
    </div>
  );
}

export default App;
