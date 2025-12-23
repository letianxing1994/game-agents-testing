import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './ChatDialog.css';

interface ChatDialogProps {
  agentType: string;
  onClose: () => void;
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

function ChatDialog({ agentType, onClose }: ChatDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);

    try {
      await axios.post(`/api/agents/${agentType}/message`, {
        message: input,
      });

      // Add confirmation message
      const confirmMessage: Message = {
        role: 'agent',
        content: 'Message received. I will consider this in my next iteration.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, confirmMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage: Message = {
        role: 'agent',
        content: 'Error: Failed to send message to agent.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
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

  return (
    <div className="chat-dialog-overlay" onClick={onClose}>
      <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="chat-dialog-header">
          <h3>Chat with {agentType} Agent</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              <p>Send a message to provide additional information to the agent.</p>
              <p>The agent will consider your messages in its next iteration.</p>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-message ${msg.role}`}>
              <div className="message-content">{msg.content}</div>
              <div className="message-timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-container">
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
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
      </div>
    </div>
  );
}

export default ChatDialog;
