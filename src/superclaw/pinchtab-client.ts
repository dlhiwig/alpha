/**
 * PinchTab Client for Alpha SuperClaw
 * 
 * HTTP client for PinchTab browser automation server.
 * Provides browser capabilities to all Alpha agents via shared PinchTab instance.
 * 
 * Token-efficient: ~800 tokens/page vs ~10K for screenshots (93% savings)
 */

interface PinchTabConfig {
  baseUrl: string;
  token: string;
  profile: string;
  timeout: number;
}

interface PinchTabTab {
  tabId: string;
  instanceId: string;
  url: string;
  title: string;
}

interface PinchTabSnapshot {
  elements: Array<{
    ref: string;
    role: string;
    name: string;
    text?: string;
  }>;
  url: string;
  title: string;
}

const DEFAULT_CONFIG: PinchTabConfig = {
  baseUrl: 'http://localhost:9867',
  token: process.env.PINCHTAB_TOKEN || 'pinchtab-local-key',
  profile: 'alpha',
  timeout: 30000,
};

export class PinchTabClient {
  private config: PinchTabConfig;

  constructor(config?: Partial<PinchTabConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PinchTab ${res.status}: ${text}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await res.json();
      }
      return await res.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Check if PinchTab server is healthy */
  async health(): Promise<{ status: string; version: string; instances: number }> {
    return this.request('/health');
  }

  /** Navigate default tab to URL */
  async navigate(url: string): Promise<any> {
    return this.request('/tabs/default/navigate', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  /** Get page text content (token-efficient) */
  async text(): Promise<string> {
    return this.request('/tabs/default/text');
  }

  /** Get interactive snapshot (clickable elements with refs) */
  async snapshot(filter: 'all' | 'interactive' | 'text' = 'interactive'): Promise<PinchTabSnapshot> {
    return this.request(`/tabs/default/snapshot?filter=${filter}`);
  }

  /** Click element by ref */
  async click(ref: string): Promise<any> {
    return this.request('/tabs/default/action', {
      method: 'POST',
      body: JSON.stringify({ kind: 'click', ref }),
    });
  }

  /** Fill input by ref */
  async fill(ref: string, text: string): Promise<any> {
    return this.request('/tabs/default/action', {
      method: 'POST',
      body: JSON.stringify({ kind: 'fill', ref, text }),
    });
  }

  /** Press key on element */
  async press(ref: string, key: string): Promise<any> {
    return this.request('/tabs/default/action', {
      method: 'POST',
      body: JSON.stringify({ kind: 'press', ref, key }),
    });
  }

  /** Launch a new isolated instance */
  async launchInstance(name: string, mode: 'headless' | 'headed' = 'headless'): Promise<{ id: string }> {
    return this.request('/instances/launch', {
      method: 'POST',
      body: JSON.stringify({ name, mode, profile: this.config.profile }),
    });
  }

  /** Open tab in specific instance */
  async openTab(instanceId: string, url: string): Promise<PinchTabTab> {
    return this.request(`/instances/${instanceId}/tabs/open`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  /** Get text from specific tab */
  async tabText(tabId: string): Promise<string> {
    return this.request(`/tabs/${tabId}/text`);
  }

  /** Navigate specific tab */
  async tabNavigate(tabId: string, url: string): Promise<any> {
    return this.request(`/tabs/${tabId}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  /** Snapshot specific tab */
  async tabSnapshot(tabId: string, filter: 'all' | 'interactive' | 'text' = 'interactive'): Promise<PinchTabSnapshot> {
    return this.request(`/tabs/${tabId}/snapshot?filter=${filter}`);
  }

  /** Click on specific tab */
  async tabClick(tabId: string, ref: string): Promise<any> {
    return this.request(`/tabs/${tabId}/action`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'click', ref }),
    });
  }

  /** List all instances */
  async listInstances(): Promise<any[]> {
    return this.request('/instances');
  }

  /** List profiles */
  async listProfiles(): Promise<any[]> {
    return this.request('/profiles');
  }
}

/** Singleton for Alpha runtime */
let _client: PinchTabClient | null = null;

export function getPinchTab(config?: Partial<PinchTabConfig>): PinchTabClient {
  if (!_client) {
    _client = new PinchTabClient(config);
  }
  return _client;
}

export default PinchTabClient;
