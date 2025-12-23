import React, { useState, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import axios from 'axios';
import './AgentNode.css';

interface AgentSkill {
  name: string;
  description: string;
  type: 'plugin' | 'mcp' | 'tool';
}

interface AgentConfig {
  id: string;
  type: string;
  label: string;
  scenario: string;
  prompt?: string;
  suggestedQuestions?: string;
  workflow?: any;
  skills?: AgentSkill[];
}

interface AgentNodeProps {
  data: {
    label: string;
    type: string;
    status: string;
  };
  id: string;
}

const statusColors: Record<string, string> = {
  idle: '#666',
  running: '#4CAF50',
  paused: '#FF9800',
  completed: '#2196F3',
  error: '#f44336',
  waiting_for_user: '#9C27B0',
  waiting_for_approval: '#FF5722',
};

const statusIcons: Record<string, string> = {
  idle: '⏸',
  running: '▶',
  paused: '⏸',
  completed: '✓',
  error: '✗',
  waiting_for_user: '❓',
  waiting_for_approval: '👀',
};

function AgentNode({ data, id }: AgentNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<AgentConfig>({
    id,
    type: data.type,
    label: data.label,
    scenario: '',
    prompt: '',
    suggestedQuestions: '',
    workflow: null,
    skills: [],
  });
  const [saving, setSaving] = useState(false);

  const statusColor = statusColors[data.status] || '#666';
  const statusIcon = statusIcons[data.status] || '?';

  useEffect(() => {
    loadConfig();
  }, [data.type]);

  const loadConfig = async () => {
    try {
      const response = await axios.get(`/api/agents/${data.type}/config`);
      setConfig(response.data);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await axios.post(`/api/agents/${data.type}/config`, config);
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const addSkill = () => {
    setConfig({
      ...config,
      skills: [
        ...(config.skills || []),
        { name: '', description: '', type: 'tool' },
      ],
    });
  };

  const removeSkill = (index: number) => {
    setConfig({
      ...config,
      skills: config.skills?.filter((_, i) => i !== index),
    });
  };

  const updateSkill = (index: number, updates: Partial<AgentSkill>) => {
    setConfig({
      ...config,
      skills: config.skills?.map((skill, i) =>
        i === index ? { ...skill, ...updates } : skill
      ),
    });
  };

  return (
    <div className={`agent-node ${expanded ? 'expanded' : ''}`} style={{ borderColor: statusColor }}>
      <Handle type="target" position={Position.Left} />

      <div className="agent-node-header" style={{ background: statusColor }}>
        <span className="agent-node-icon">{statusIcon}</span>
        <span className="agent-node-title">{data.label}</span>
        <button
          className="expand-btn"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '▼' : '▶'}
        </button>
      </div>

      {!expanded && (
        <div className="agent-node-body">
          <div className="agent-node-type">{data.type}</div>
          <div className="agent-node-status">{data.status}</div>
        </div>
      )}

      {expanded && (
        <div className="agent-node-config">
          <div className="config-section">
            <h4>适用场景 <span className="required">*</span></h4>
            <textarea
              value={config.scenario}
              onChange={(e) =>
                setConfig({ ...config, scenario: e.target.value })
              }
              placeholder="描述此节点的功能和适用场景，用于帮助节点理解什么情况下应该切换到此节点。"
              rows={3}
              className={!config.scenario ? 'invalid' : ''}
            />
          </div>

          <div className="config-section">
            <h4>Agent提示词</h4>
            <textarea
              value={config.prompt || ''}
              onChange={(e) =>
                setConfig({ ...config, prompt: e.target.value })
              }
              placeholder="输入agent的系统提示词（可选）..."
              rows={4}
            />
          </div>

          <div className="config-section">
            <h4>用户问题建议</h4>
            <textarea
              value={config.suggestedQuestions || ''}
              onChange={(e) =>
                setConfig({ ...config, suggestedQuestions: e.target.value })
              }
              placeholder="在智能体回答后，自动根据对话内容提供3条用户提问建议"
              rows={2}
            />
          </div>

          <div className="config-section">
            <h4>Workflow</h4>
            <div className="workflow-status">
              {config.workflow ? (
                <span className="badge success">已配置</span>
              ) : (
                <span className="badge secondary">未配置</span>
              )}
            </div>
          </div>

          <div className="config-section">
            <div className="section-header">
              <h4>技能</h4>
              <button className="btn-small" onClick={addSkill}>
                + 添加技能
              </button>
            </div>

            {config.skills && config.skills.length > 0 ? (
              <div className="skills-list">
                {config.skills.map((skill, index) => (
                  <div key={index} className="skill-item">
                    <input
                      type="text"
                      placeholder="技能名称"
                      value={skill.name}
                      onChange={(e) =>
                        updateSkill(index, { name: e.target.value })
                      }
                    />
                    <select
                      value={skill.type}
                      onChange={(e) =>
                        updateSkill(index, {
                          type: e.target.value as 'plugin' | 'mcp' | 'tool',
                        })
                      }
                    >
                      <option value="tool">Tool</option>
                      <option value="plugin">Plugin</option>
                      <option value="mcp">MCP</option>
                    </select>
                    <button
                      className="btn-icon-small"
                      onClick={() => removeSkill(index)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state-small">未定义技能</p>
            )}
          </div>

          <div className="config-actions">
            <button
              className="btn-save"
              onClick={saveConfig}
              disabled={!config.scenario || saving}
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default AgentNode;
