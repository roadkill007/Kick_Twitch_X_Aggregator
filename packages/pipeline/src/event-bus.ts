import { EventEmitter } from 'node:events';
import type { UnifiedMessage } from './types.js';

export class MessageEventBus {
  private readonly emitter = new EventEmitter();

  publish(message: UnifiedMessage): void {
    this.emitter.emit('message', message);
    this.emitter.emit(`session:${message.sessionId}`, message);
  }

  onMessage(callback: (message: UnifiedMessage) => void): () => void {
    this.emitter.on('message', callback);
    return () => this.emitter.off('message', callback);
  }

  onSessionMessage(sessionId: string, callback: (message: UnifiedMessage) => void): () => void {
    const event = `session:${sessionId}`;
    this.emitter.on(event, callback);
    return () => this.emitter.off(event, callback);
  }
}
