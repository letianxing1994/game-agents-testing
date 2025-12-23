import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { A2AMessage, AgentType, MessageType } from '../a2a/message-types.js';
import { BaseLLMClient } from '../llm/base-llm-client.js';
import { PersistenceManager } from '../storage/persistence.js';
import { WorkflowEngine } from '../workflow/workflow-engine.js';
import { Workflow, WorkflowExecutionContext } from '../workflow/workflow-types.js';
import { Tool } from '../workflow/react-executor.js';

export enum AgentStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ERROR = 'error',
  WAITING_FOR_USER = 'waiting_for_user',
  WAITING_FOR_APPROVAL = 'waiting_for_approval',
}

export abstract class BaseAgent {
  protected id: string;
  protected type: AgentType;
  protected status: AgentStatus = AgentStatus.IDLE;
  protected llmClient: BaseLLMClient;
  protected persistenceManager: PersistenceManager;
  protected workflowEngine: WorkflowEngine;
  protected ws: WebSocket | null = null;
  protected a2aServerUrl: string;
  protected messageQueue: A2AMessage[] = [];
  protected userMessages: string[] = [];
  protected executionContext: WorkflowExecutionContext;
  protected goalAchieved: boolean = false;
  protected currentWorkflow: Workflow | null = null;
  protected tools: Tool[] = [];
  protected executionMode: 'automatic' | 'interactive' = 'automatic';
  protected currentQuestion: string | null = null;
  protected artifactForApproval: any = null;
  protected agentConfig: any = null; // Store agent configuration including scenario
  protected askedForInitialInput: boolean = false; // Track if we've asked for initial input

  constructor(
    type: AgentType,
    llmClient: BaseLLMClient,
    persistenceManager: PersistenceManager,
    a2aServerUrl: string
  ) {
    this.id = uuidv4();
    this.type = type;
    this.llmClient = llmClient;
    this.persistenceManager = persistenceManager;
    this.a2aServerUrl = a2aServerUrl;
    this.workflowEngine = new WorkflowEngine(llmClient, persistenceManager);
    this.executionContext = {
      variables: {},
      iteration: 0,
      history: [],
      userMessages: [],
      previousArtifacts: {},
    };

    this.initializeTools();
  }

  protected abstract initializeTools(): void;
  protected abstract getDefaultGoal(): string;
  protected abstract getSystemPrompt(): string;
  protected abstract processArtifact(artifact: any): Promise<void>;

  async connectToA2A(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.a2aServerUrl);

      this.ws.on('open', () => {
        console.log(`[${this.type}] Connected to A2A server`);
        this.ws!.send(JSON.stringify({ type: 'register', agentType: this.type }));
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'a2a_message') {
            this.handleA2AMessage(message.payload);
          }
        } catch (error) {
          console.error(`[${this.type}] Failed to parse message:`, error);
        }
      });

      this.ws.on('error', (error) => {
        console.error(`[${this.type}] WebSocket error:`, error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log(`[${this.type}] Disconnected from A2A server`);
      });
    });
  }

  protected handleA2AMessage(message: A2AMessage): void {
    console.log(`[${this.type}] Received message from ${message.from}:`, message.type);

    // Don't auto-start on AGENT_START messages - agents should only start when
    // explicitly called via agent.start() or when server triggers them after dependencies are met
    if (message.type === MessageType.AGENT_START) {
      this.messageQueue.push(message);
      // Removed auto-start logic - agents are started explicitly by server based on dependencies
    } else if (message.type === MessageType.USER_MESSAGE) {
      this.userMessages.push(message.payload.content || '');
    } else if (message.type === MessageType.AGENT_COMPLETE && message.payload.artifactPath) {
      this.executionContext.previousArtifacts[message.from] = message.payload.artifactPath;
    }
  }

  protected sendA2AMessage(message: Omit<A2AMessage, 'id' | 'timestamp'>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[${this.type}] Cannot send message: WebSocket not connected`);
      return;
    }

    const fullMessage: A2AMessage = {
      ...message,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify({ type: 'a2a_message', payload: fullMessage }));
  }

  async start(initialData?: any, mode?: 'automatic' | 'interactive'): Promise<void> {
    if (this.status === AgentStatus.RUNNING) {
      console.log(`[${this.type}] Agent already running`);
      return;
    }

    // Load agent configuration
    this.agentConfig = await this.persistenceManager.readAgentConfig(this.type);
    if (!this.agentConfig || !this.agentConfig.scenario) {
      throw new Error(`Agent ${this.type} must have a scenario configured to define completion criteria`);
    }

    this.executionMode = mode || 'automatic';
    this.status = AgentStatus.RUNNING;
    this.goalAchieved = false;
    this.executionContext.variables = { ...initialData };

    this.sendA2AMessage({
      type: MessageType.AGENT_START,
      from: this.type,
      to: 'all',
      payload: { content: `${this.type} agent started in ${this.executionMode} mode` },
    });

    try {
      await this.run();
    } catch (error: any) {
      this.status = AgentStatus.ERROR;
      this.sendA2AMessage({
        type: MessageType.AGENT_ERROR,
        from: this.type,
        to: 'all',
        payload: { error: error.message },
      });
    }
  }

  protected async run(): Promise<void> {
    // Load workflow if exists
    const savedWorkflow = await this.persistenceManager.readWorkflow(this.type);
    if (savedWorkflow) {
      this.currentWorkflow = savedWorkflow;
    }

    // Main loop - continue while not achieved goal and not in error state
    while (!this.goalAchieved && this.status !== AgentStatus.ERROR) {
      // Wait if in waiting states - block here without doing anything else
      if (this.status === AgentStatus.WAITING_FOR_USER) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (this.status === AgentStatus.WAITING_FOR_APPROVAL) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Only proceed if in RUNNING state
      if (this.status !== AgentStatus.RUNNING) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // In interactive mode, ask for initial user input ONCE
      if (this.executionMode === 'interactive' && !this.askedForInitialInput && this.userMessages.length === 0) {
        this.askedForInitialInput = true; // Set flag to prevent re-asking
        this.currentQuestion = 'Please provide your initial requirements to begin.';
        this.status = AgentStatus.WAITING_FOR_USER;

        this.sendA2AMessage({
          type: MessageType.AGENT_PROGRESS,
          from: this.type,
          to: 'all',
          payload: {
            content: this.currentQuestion,
            data: { status: 'waiting_for_user', question: this.currentQuestion },
          },
        });

        console.log(`[${this.type}] Waiting for initial user input...`);
        // Continue loop, will wait at the top
        continue;
      }

      // Increment iteration only when actually executing
      this.executionContext.iteration++;

      this.executionContext.userMessages = [...this.userMessages];
      this.userMessages = []; // Clear consumed messages

      if (this.currentWorkflow) {
        // Execute custom workflow
        await this.executeWorkflow();
      } else {
        // Execute default ReAct loop
        await this.executeReActLoop();
      }

      // Check goal condition
      this.goalAchieved = await this.checkGoalAchievement();

      // In interactive mode, ask for artifact approval
      if (this.executionMode === 'interactive' && this.goalAchieved) {
        this.artifactForApproval = this.executionContext.variables.output;
        this.status = AgentStatus.WAITING_FOR_APPROVAL;

        this.sendA2AMessage({
          type: MessageType.AGENT_PROGRESS,
          from: this.type,
          to: 'all',
          payload: {
            content: 'Task completed. Please review the artifact.',
            data: {
              status: 'waiting_for_approval',
              artifact: this.artifactForApproval,
            },
          },
        });

        console.log(`[${this.type}] Waiting for artifact approval...`);
        // Continue loop, will wait at the top
        continue;
      } else {
        // Send progress update
        this.sendA2AMessage({
          type: MessageType.AGENT_PROGRESS,
          from: this.type,
          to: 'all',
          payload: {
            content: `Iteration ${this.executionContext.iteration} completed`,
            data: { goalAchieved: this.goalAchieved },
          },
        });
      }

      // Small delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (this.goalAchieved) {
      this.status = AgentStatus.COMPLETED;
      const artifact = this.executionContext.variables.output;
      await this.processArtifact(artifact);

      this.sendA2AMessage({
        type: MessageType.AGENT_COMPLETE,
        from: this.type,
        to: 'all',
        payload: {
          content: `${this.type} agent completed`,
          data: artifact,
          artifactPath: this.executionContext.variables.artifactPath,
        },
      });
    }
  }

  protected async executeWorkflow(): Promise<void> {
    if (!this.currentWorkflow) return;

    // Register tools with workflow engine
    for (const tool of this.tools) {
      this.workflowEngine.addTool(tool);
    }

    const result = await this.workflowEngine.executeWorkflow(
      this.currentWorkflow,
      this.executionContext
    );

    if (result.success) {
      this.executionContext = result.context;
      this.executionContext.variables.output = result.output;
    } else {
      throw new Error(result.error);
    }
  }

  protected async executeReActLoop(): Promise<void> {
    // Pure ReAct loop without custom workflow
    const task = this.getDefaultGoal();
    let systemPrompt = this.getSystemPrompt();

    // Add scenario to system prompt if configured
    if (this.agentConfig?.scenario) {
      systemPrompt += `\n\nCompletion Criteria (适用场景): ${this.agentConfig.scenario}`;
      systemPrompt += `\nYour task is complete when you have successfully satisfied the above completion criteria.`;
    }

    // Add custom prompt if configured
    if (this.agentConfig?.prompt) {
      systemPrompt += `\n\nAdditional Instructions: ${this.agentConfig.prompt}`;
    }

    // Add suggested questions if in interactive mode
    if (this.executionMode === 'interactive' && this.agentConfig?.suggestedQuestions) {
      systemPrompt += `\n\nWhen asking for user input, you may use these suggested questions: ${this.agentConfig.suggestedQuestions}`;
    }

    const reactExecutor = new (await import('../workflow/react-executor.js')).ReActExecutor(
      this.llmClient,
      this.tools
    );

    // Set progress callback to send updates
    reactExecutor.setProgressCallback((step) => {
      this.sendA2AMessage({
        type: MessageType.AGENT_PROGRESS,
        from: this.type,
        to: 'all',
        payload: {
          content: 'ReAct step executed',
          data: {
            step: step,
            iteration: this.executionContext.iteration,
          },
        },
      });
    });

    const result = await reactExecutor.execute(task, this.executionContext, systemPrompt);

    if (result.success) {
      this.executionContext.variables.output = result.result;
      this.executionContext.history.push(...result.steps);
    } else {
      throw new Error(result.result);
    }
  }

  protected async checkGoalAchievement(): Promise<boolean> {
    // First check if custom workflow has goal condition
    if (this.currentWorkflow?.goalCondition) {
      try {
        return eval(this.currentWorkflow.goalCondition);
      } catch {
        return false;
      }
    }

    // Use scenario as completion criteria
    // The scenario describes what conditions need to be met for the task to be complete
    // Check if output is generated - this is a basic check
    // More sophisticated logic could parse the scenario and evaluate against execution context
    if (!this.executionContext.variables.output) {
      return false;
    }

    // If scenario is defined, we assume the agent used it as guidance
    // and produced output when criteria are met
    if (this.agentConfig?.scenario) {
      // TODO: In future, could use LLM to evaluate if scenario criteria are met
      // For now, trust that agent completed when it produced output
      return true;
    }

    // Default: check if output is generated
    return !!this.executionContext.variables.output;
  }

  async setWorkflow(workflow: Workflow): Promise<void> {
    this.currentWorkflow = workflow;
    await this.persistenceManager.saveWorkflow(this.type, workflow);
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  async sendUserMessage(message: string): Promise<void> {
    this.userMessages.push(message);

    // If agent is waiting for user, resume execution
    if (this.status === AgentStatus.WAITING_FOR_USER) {
      this.status = AgentStatus.RUNNING;
      this.currentQuestion = null;
    }
  }

  async approveArtifact(approved: boolean): Promise<void> {
    if (this.status !== AgentStatus.WAITING_FOR_APPROVAL) {
      throw new Error('Agent is not waiting for approval');
    }

    if (approved) {
      this.goalAchieved = true;
      this.status = AgentStatus.RUNNING; // Will complete in next iteration
    } else {
      this.goalAchieved = false;
      this.status = AgentStatus.RUNNING; // Will continue iterating
      this.artifactForApproval = null;
    }
  }

  getCurrentQuestion(): string | null {
    return this.currentQuestion;
  }

  getArtifactForApproval(): any {
    return this.artifactForApproval;
  }

  async pause(): Promise<void> {
    this.status = AgentStatus.PAUSED;
  }

  async resume(): Promise<void> {
    if (this.status === AgentStatus.PAUSED) {
      this.status = AgentStatus.RUNNING;
    }
  }

  async stop(): Promise<void> {
    this.status = AgentStatus.IDLE;
    this.goalAchieved = true;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}
