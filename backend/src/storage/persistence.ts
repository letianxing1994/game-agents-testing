import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PersistenceManager {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'outputs');
    this.initializeDirectories();
  }

  private async initializeDirectories(): Promise<void> {
    const dirs = [
      this.baseDir,
      path.join(this.baseDir, 'gdd'),
      path.join(this.baseDir, 'assets'),
      path.join(this.baseDir, 'code'),
      path.join(this.baseDir, 'workflows'),
      path.join(this.baseDir, 'configs'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async saveGDD(filename: string, content: string): Promise<string> {
    const gddDir = path.join(this.baseDir, 'gdd');
    await fs.mkdir(gddDir, { recursive: true });
    const filePath = path.join(gddDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  async readGDD(filename: string): Promise<string> {
    const filePath = path.join(this.baseDir, 'gdd', filename);
    return await fs.readFile(filePath, 'utf-8');
  }

  async saveAsset(filename: string, data: Buffer | string): Promise<string> {
    const assetDir = path.join(this.baseDir, 'assets');
    await fs.mkdir(assetDir, { recursive: true });
    const filePath = path.join(assetDir, filename);
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async readAsset(filename: string): Promise<Buffer> {
    const filePath = path.join(this.baseDir, 'assets', filename);
    return await fs.readFile(filePath);
  }

  async saveCode(filename: string, content: string): Promise<string> {
    const codeDir = path.join(this.baseDir, 'code');
    await fs.mkdir(codeDir, { recursive: true });
    const filePath = path.join(codeDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  async readCode(filename: string): Promise<string> {
    const filePath = path.join(this.baseDir, 'code', filename);
    return await fs.readFile(filePath, 'utf-8');
  }

  async saveWorkflow(agentType: string, workflow: any): Promise<string> {
    const workflowDir = path.join(this.baseDir, 'workflows');
    await fs.mkdir(workflowDir, { recursive: true });
    const filename = `${agentType}_workflow.json`;
    const filePath = path.join(workflowDir, filename);
    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
    return filePath;
  }

  async readWorkflow(agentType: string): Promise<any> {
    const filename = `${agentType}_workflow.json`;
    const filePath = path.join(this.baseDir, 'workflows', filename);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async listFiles(directory: 'gdd' | 'assets' | 'code'): Promise<string[]> {
    const dirPath = path.join(this.baseDir, directory);
    try {
      return await fs.readdir(dirPath);
    } catch (error) {
      return [];
    }
  }

  async deleteFile(directory: 'gdd' | 'assets' | 'code', filename: string): Promise<void> {
    const filePath = path.join(this.baseDir, directory, filename);
    await fs.unlink(filePath);
  }

  getFilePath(directory: 'gdd' | 'assets' | 'code', filename: string): string {
    return path.join(this.baseDir, directory, filename);
  }

  async saveAgentConfig(agentType: string, config: any): Promise<string> {
    const configDir = path.join(this.baseDir, 'configs');
    await fs.mkdir(configDir, { recursive: true });
    const filename = `${agentType}_config.json`;
    const filePath = path.join(configDir, filename);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
    return filePath;
  }

  async readAgentConfig(agentType: string): Promise<any> {
    const filename = `${agentType}_config.json`;
    const filePath = path.join(this.baseDir, 'configs', filename);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async saveExecutionState(state: any): Promise<string> {
    const configDir = path.join(this.baseDir, 'configs');
    await fs.mkdir(configDir, { recursive: true });
    const filePath = path.join(configDir, 'execution_state.json');
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    return filePath;
  }

  async readExecutionState(): Promise<any> {
    const filePath = path.join(this.baseDir, 'configs', 'execution_state.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }
}
