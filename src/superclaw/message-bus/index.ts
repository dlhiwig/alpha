import EventEmitter from 'events';

type EventCallback = (...args: any[]) => void;

interface Agent {
  id: string;
  name: string;
  subscribe: (event: string, callback: EventCallback) => void;
  unsubscribe: (event: string, callback: EventCallback) => void;
  publish: (event: string, data: any) => void;
}

class MessageBus {
  private eventEmitter: EventEmitter;
  /** @internal Exposed for testing */
  readonly agentRegistry: Map<string, Agent>;

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.agentRegistry = new Map();
  }

  registerAgent(agent: Agent): void {
    this.agentRegistry.set(agent.id, agent);
  }

  unregisterAgent(agentId: string): void {
    this.agentRegistry.delete(agentId);
  }

  publish(event: string, data: any): void {
    this.eventEmitter.emit(event, data);
  }

  subscribe(event: string, callback: EventCallback): void {
    this.eventEmitter.on(event, callback);
  }

  unsubscribe(event: string, callback: EventCallback): void {
    this.eventEmitter.off(event, callback);
  }
}

export default MessageBus;
