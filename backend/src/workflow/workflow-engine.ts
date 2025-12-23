import {
  Workflow,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowExecutionContext,
  WorkflowExecutionResult,
} from './workflow-types.js';
import { ReActExecutor, Tool } from './react-executor.js';
import { BaseLLMClient } from '../llm/base-llm-client.js';
import { PersistenceManager } from '../storage/persistence.js';

export class WorkflowEngine {
  private llmClient: BaseLLMClient;
  private persistenceManager: PersistenceManager;
  private tools: Map<string, Tool> = new Map();

  constructor(llmClient: BaseLLMClient, persistenceManager: PersistenceManager) {
    this.llmClient = llmClient;
    this.persistenceManager = persistenceManager;
  }

  addTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async executeWorkflow(
    workflow: Workflow,
    initialContext: Partial<WorkflowExecutionContext> = {}
  ): Promise<WorkflowExecutionResult> {
    const context: WorkflowExecutionContext = {
      variables: initialContext.variables || {},
      iteration: initialContext.iteration || 0,
      history: initialContext.history || [],
      userMessages: initialContext.userMessages || [],
      previousArtifacts: initialContext.previousArtifacts || {},
    };

    try {
      let currentNodeId: string | undefined = workflow.startNode;

      while (currentNodeId) {
        const node = workflow.nodes.find(n => n.id === currentNodeId);
        if (!node) {
          throw new Error(`Node ${currentNodeId} not found in workflow`);
        }

        const result = await this.executeNode(node, context, workflow);
        context.history.push({ node: node.id, result });

        // Check goal condition
        if (this.evaluateGoalCondition(workflow.goalCondition, context)) {
          return {
            success: true,
            output: context.variables.output || result,
            context,
          };
        }

        // Determine next node
        currentNodeId = this.determineNextNode(node, result, context);
      }

      return {
        success: true,
        output: context.variables.output,
        context,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        context,
      };
    }
  }

  private async executeNode(
    node: WorkflowNode,
    context: WorkflowExecutionContext,
    workflow: Workflow
  ): Promise<any> {
    switch (node.type) {
      case WorkflowNodeType.TOOL_CALL:
        return await this.executeToolCall(node, context);

      case WorkflowNodeType.DATA_ACCESS:
        return await this.executeDataAccess(node, context);

      case WorkflowNodeType.REACT:
        return await this.executeReAct(node, context);

      case WorkflowNodeType.CONDITION:
        return this.evaluateCondition(node, context);

      case WorkflowNodeType.LOOP:
        return await this.executeLoop(node, context, workflow);

      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  private async executeToolCall(
    node: WorkflowNode,
    context: WorkflowExecutionContext
  ): Promise<any> {
    const toolName = node.config.toolName;
    if (!toolName) {
      throw new Error(`Tool name not specified in node ${node.id}`);
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    const params = this.resolveParameters(node.config.toolParams || {}, context);
    return await tool.execute(params, context);
  }

  private async executeDataAccess(
    node: WorkflowNode,
    context: WorkflowExecutionContext
  ): Promise<any> {
    const dataSource = node.config.dataSource;
    if (!dataSource) {
      throw new Error(`Data source not specified in node ${node.id}`);
    }

    // Access previous artifacts or variables
    if (dataSource.startsWith('artifact:')) {
      const artifactKey = dataSource.replace('artifact:', '');
      return context.previousArtifacts[artifactKey];
    }

    if (dataSource.startsWith('variable:')) {
      const varName = dataSource.replace('variable:', '');
      return context.variables[varName];
    }

    throw new Error(`Unknown data source: ${dataSource}`);
  }

  private async executeReAct(
    node: WorkflowNode,
    context: WorkflowExecutionContext
  ): Promise<any> {
    const reactExecutor = new ReActExecutor(
      this.llmClient,
      Array.from(this.tools.values())
    );

    const task = node.config.reactPrompt || 'Complete the current task';
    const taskWithContext = this.resolveString(task, context);

    const result = await reactExecutor.execute(taskWithContext, context);
    return result.result;
  }

  private evaluateCondition(node: WorkflowNode, context: WorkflowExecutionContext): boolean {
    const condition = node.config.condition;
    if (!condition) {
      return false;
    }

    try {
      // Simple condition evaluation (can be enhanced with a proper expression parser)
      const resolvedCondition = this.resolveString(condition, context);
      return eval(resolvedCondition);
    } catch (error) {
      console.error('Condition evaluation error:', error);
      return false;
    }
  }

  private async executeLoop(
    node: WorkflowNode,
    context: WorkflowExecutionContext,
    workflow: Workflow
  ): Promise<any> {
    const maxIterations = node.config.maxIterations || 10;
    const results: any[] = [];

    for (let i = 0; i < maxIterations; i++) {
      context.iteration = i;

      if (this.evaluateGoalCondition(workflow.goalCondition, context)) {
        break;
      }

      // Execute loop body (would need to define loop body nodes)
      const loopResult = { iteration: i };
      results.push(loopResult);
    }

    return results;
  }

  private evaluateGoalCondition(condition: string, context: WorkflowExecutionContext): boolean {
    if (!condition) {
      return false;
    }

    try {
      const resolvedCondition = this.resolveString(condition, context);
      return eval(resolvedCondition);
    } catch (error) {
      return false;
    }
  }

  private determineNextNode(
    node: WorkflowNode,
    result: any,
    context: WorkflowExecutionContext
  ): string | undefined {
    if (!node.next) {
      return undefined;
    }

    if (typeof node.next === 'string') {
      return node.next;
    }

    // Handle conditional branching
    if (Array.isArray(node.next) && node.next.length > 0) {
      return result ? node.next[0] : node.next[1];
    }

    return undefined;
  }

  private resolveParameters(params: Record<string, any>, context: WorkflowExecutionContext): any {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        resolved[key] = this.resolveString(value, context);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private resolveString(str: string, context: WorkflowExecutionContext): string {
    return str.replace(/\{\{(.+?)\}\}/g, (_, varName) => {
      const trimmed = varName.trim();
      if (trimmed.startsWith('context.')) {
        const path = trimmed.substring(8);
        return this.getNestedValue(context, path);
      }
      return context.variables[trimmed] || '';
    });
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
