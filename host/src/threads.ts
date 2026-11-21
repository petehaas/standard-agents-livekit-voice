/** The few Standard Agents Builder REST calls the host needs. */

export class ThreadsApi {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(new URL(`/api${path}`, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} /api${path} returned ${response.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Create a thread for an agent. `env` sets thread-level variables, such as provider choices. */
  async createThread(agentId: string, options: { tags?: string[]; env?: Record<string, string> } = {}) {
    const result = await this.request<{ threadId: string }>('POST', '/threads', {
      agent_id: agentId,
      tags: options.tags,
      env: options.env && Object.keys(options.env).length > 0 ? options.env : undefined,
    });
    return result.threadId;
  }

  async sendMessage(threadId: string, content: string) {
    await this.request('POST', `/threads/${encodeURIComponent(threadId)}/messages`, { role: 'user', content });
  }

  async stopThread(threadId: string) {
    await this.request('POST', `/threads/${encodeURIComponent(threadId)}/stop`, {});
  }
}
