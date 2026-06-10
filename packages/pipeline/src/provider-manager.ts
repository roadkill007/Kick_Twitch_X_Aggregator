import type { ProviderRuntime } from './types.js';
import type { MessageRouter } from './router.js';

export class ProviderManager {
  private readonly providers = new Map<string, ProviderRuntime>();
  private readonly failedProviders = new Map<string, Error>();

  constructor(private readonly router: MessageRouter) {}

  register(provider: ProviderRuntime): void {
    if (this.providers.has(provider.name)) throw new Error(`Provider already registered: ${provider.name}`);
    provider.onMessage((message) => this.router.accept(message));
    this.providers.set(provider.name, provider);
  }

  async startAll(): Promise<void> {
    await Promise.all([...this.providers.values()].map(async (provider) => {
      try {
        await provider.start();
      } catch (error) {
        this.failedProviders.set(provider.name, error instanceof Error ? error : new Error(String(error)));
      }
    }));
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.stop()));
  }

  isFailed(providerName: string): boolean {
    return this.failedProviders.has(providerName);
  }

  activeProviderNames(): string[] {
    return [...this.providers.keys()].filter((name) => !this.failedProviders.has(name));
  }
}
