import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { A2AMessage, AgentType, MessageType } from './message-types.js';

export class A2AServer {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();
  private agentClients: Map<AgentType, string> = new Map();
  private messageQueue: Map<AgentType, A2AMessage[]> = new Map();
  private messageHandlers: Map<string, (message: A2AMessage) => void> = new Map();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.initializeMessageQueues();
    this.setupWebSocketServer();
    console.log(`A2A Server started on port ${port}`);
  }

  private initializeMessageQueues(): void {
    this.messageQueue.set(AgentType.PLANNER, []);
    this.messageQueue.set(AgentType.ARTIST, []);
    this.messageQueue.set(AgentType.DEVELOPER, []);
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuidv4();
      this.clients.set(clientId, ws);

      console.log(`Client connected: ${clientId}`);

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        this.clients.delete(clientId);

        // Remove agent registration
        for (const [agentType, id] of this.agentClients.entries()) {
          if (id === clientId) {
            this.agentClients.delete(agentType);
            break;
          }
        }
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
      });
    });
  }

  private handleMessage(clientId: string, message: any): void {
    if (message.type === 'register' && message.agentType) {
      // Register agent
      this.agentClients.set(message.agentType as AgentType, clientId);
      console.log(`Agent registered: ${message.agentType} -> ${clientId}`);

      // Send queued messages to the agent
      this.sendQueuedMessages(message.agentType as AgentType);
      return;
    }

    if (message.type === 'a2a_message') {
      const a2aMessage: A2AMessage = message.payload;
      this.routeMessage(a2aMessage);
    }
  }

  private routeMessage(message: A2AMessage): void {
    console.log(`Routing message from ${message.from} to ${message.to}`);

    if (message.to === 'all') {
      // Broadcast to ALL connected clients (agents + UI clients)
      const clientCount = this.clients.size;
      console.log(`Broadcasting to ${clientCount} connected clients`);

      // Debug: show registered agent types
      const registeredAgents = Array.from(this.agentClients.entries()).map(([type, id]) => type);
      console.log(`Registered agents: ${registeredAgents.join(', ')}`);

      for (const [clientId, ws] of this.clients.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'a2a_message', payload: message }));
        }
      }
    } else {
      // Send to specific agent
      this.deliverMessage(message.to as AgentType, message);
    }

    // Notify message handlers
    for (const handler of this.messageHandlers.values()) {
      handler(message);
    }
  }

  private deliverMessage(agentType: AgentType, message: A2AMessage): void {
    const clientId = this.agentClients.get(agentType);

    if (clientId && this.clients.has(clientId)) {
      const ws = this.clients.get(clientId)!;
      ws.send(JSON.stringify({ type: 'a2a_message', payload: message }));
    } else {
      // Queue message if agent is not connected
      console.log(`Agent ${agentType} not connected, queueing message`);
      this.messageQueue.get(agentType)?.push(message);
    }
  }

  private sendQueuedMessages(agentType: AgentType): void {
    const queue = this.messageQueue.get(agentType);
    if (queue && queue.length > 0) {
      console.log(`Sending ${queue.length} queued messages to ${agentType}`);
      for (const message of queue) {
        this.deliverMessage(agentType, message);
      }
      this.messageQueue.set(agentType, []);
    }
  }

  public sendMessage(message: A2AMessage): void {
    this.routeMessage(message);
  }

  public onMessage(handler: (message: A2AMessage) => void): string {
    const handlerId = uuidv4();
    this.messageHandlers.set(handlerId, handler);
    return handlerId;
  }

  public offMessage(handlerId: string): void {
    this.messageHandlers.delete(handlerId);
  }

  public getConnectedAgents(): AgentType[] {
    return Array.from(this.agentClients.keys());
  }
}
