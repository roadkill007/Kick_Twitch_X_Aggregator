import type { Platform, ProviderRuntime, RawProviderMessage } from './types.js';

type MessageCallback = (message: RawProviderMessage) => void;

export class MockProvider implements ProviderRuntime {
  private callback: MessageCallback | null = null;
  private running = false;

  constructor(public readonly name: string, public readonly platform: Platform) {}

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onMessage(callback: MessageCallback): void {
    this.callback = callback;
  }

  emitMockMessage(input: Omit<RawProviderMessage, 'platform' | 'emittedAt'> & { emittedAt?: Date }): void {
    if (!this.running) throw new Error(`${this.name} is not running`);
    if (!this.callback) throw new Error(`${this.name} has no message callback`);
    this.callback({ ...input, platform: this.platform, emittedAt: input.emittedAt ?? new Date() });
  }
}

export class MockTwitchProvider extends MockProvider {
  constructor(name = 'mock-twitch') { super(name, 'twitch'); }
}

export class MockKickProvider extends MockProvider {
  constructor(name = 'mock-kick') { super(name, 'kick'); }
}

export class MockXProvider extends MockProvider {
  constructor(name = 'mock-x') { super(name, 'x'); }
}

export class FailingMockProvider extends MockProvider {
  async start(): Promise<void> {
    throw new Error(`${this.name} failed to start`);
  }
}
