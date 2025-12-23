import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './WorkflowEditor.css';

interface WorkflowEditorProps {
  agentType: string;
  onClose: () => void;
}

interface WorkflowNode {
  id: string;
  type: string;
  name: string;
  config: any;
  next?: string;
}

interface Workflow {
  id: string;
  name: string;
  agentType: string;
  nodes: WorkflowNode[];
  startNode: string;
  goalCondition: string;
}

const nodeTypes = [
  { value: 'tool_call', label: 'Tool Call' },
  { value: 'data_access', label: 'Data Access' },
  { value: 'react', label: 'ReAct' },
  { value: 'condition', label: 'Condition' },
];

function WorkflowEditor({ agentType, onClose }: WorkflowEditorProps) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWorkflow();
  }, [agentType]);

  const loadWorkflow = async () => {
    try {
      const response = await axios.get(`/api/agents/${agentType}/workflow`);
      setWorkflow(response.data.workflow);
    } catch (error) {
      // Create default workflow
      setWorkflow({
        id: `${agentType}_workflow`,
        name: `${agentType} Workflow`,
        agentType,
        nodes: [],
        startNode: '',
        goalCondition: 'context.variables.output !== undefined',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!workflow) return;

    setSaving(true);
    try {
      await axios.post(`/api/agents/${agentType}/workflow`, { workflow });
      alert('Workflow saved successfully!');
      onClose();
    } catch (error) {
      alert('Failed to save workflow');
    } finally {
      setSaving(false);
    }
  };

  const addNode = () => {
    if (!workflow) return;

    const newNode: WorkflowNode = {
      id: `node_${Date.now()}`,
      type: 'react',
      name: 'New Node',
      config: {},
    };

    setWorkflow({
      ...workflow,
      nodes: [...workflow.nodes, newNode],
    });
  };

  const removeNode = (nodeId: string) => {
    if (!workflow) return;

    setWorkflow({
      ...workflow,
      nodes: workflow.nodes.filter((n) => n.id !== nodeId),
    });
  };

  const updateNode = (nodeId: string, updates: Partial<WorkflowNode>) => {
    if (!workflow) return;

    setWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...updates } : n
      ),
    });
  };

  if (loading) {
    return (
      <div className="workflow-editor-overlay">
        <div className="workflow-editor">
          <p>Loading workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-editor-overlay" onClick={onClose}>
      <div className="workflow-editor" onClick={(e) => e.stopPropagation()}>
        <div className="workflow-editor-header">
          <h3>Workflow Editor - {agentType}</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="workflow-editor-body">
          <div className="workflow-info">
            <div className="form-group">
              <label>Workflow Name:</label>
              <input
                type="text"
                value={workflow?.name || ''}
                onChange={(e) =>
                  setWorkflow({ ...workflow!, name: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>Goal Condition:</label>
              <input
                type="text"
                value={workflow?.goalCondition || ''}
                onChange={(e) =>
                  setWorkflow({ ...workflow!, goalCondition: e.target.value })
                }
                placeholder="e.g., context.variables.output !== undefined"
              />
            </div>
          </div>

          <div className="workflow-nodes">
            <div className="workflow-nodes-header">
              <h4>Workflow Nodes</h4>
              <button className="btn btn-small" onClick={addNode}>
                + Add Node
              </button>
            </div>

            {workflow?.nodes.length === 0 && (
              <div className="empty-state">
                <p>No nodes defined. The agent will use default ReAct loop.</p>
                <p>Add nodes to customize the workflow.</p>
              </div>
            )}

            {workflow?.nodes.map((node, idx) => (
              <div key={node.id} className="workflow-node-card">
                <div className="node-card-header">
                  <span className="node-number">{idx + 1}</span>
                  <input
                    type="text"
                    className="node-name"
                    value={node.name}
                    onChange={(e) =>
                      updateNode(node.id, { name: e.target.value })
                    }
                  />
                  <button
                    className="btn-icon"
                    onClick={() => removeNode(node.id)}
                  >
                    🗑
                  </button>
                </div>

                <div className="node-card-body">
                  <div className="form-group">
                    <label>Type:</label>
                    <select
                      value={node.type}
                      onChange={(e) =>
                        updateNode(node.id, { type: e.target.value })
                      }
                    >
                      {nodeTypes.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {node.type === 'react' && (
                    <div className="form-group">
                      <label>Task Prompt:</label>
                      <textarea
                        value={node.config.reactPrompt || ''}
                        onChange={(e) =>
                          updateNode(node.id, {
                            config: { ...node.config, reactPrompt: e.target.value },
                          })
                        }
                        placeholder="Describe what this step should do..."
                        rows={3}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="workflow-editor-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkflowEditor;
