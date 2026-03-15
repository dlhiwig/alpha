import MessageBus from './index';

class Agent {
  id: string;
  name: string;
  private messageBus: MessageBus;

  constructor(id: string, name: string, messageBus: MessageBus) {
    this.id = id;
    this.name = name;
    this.messageBus = messageBus;
    this.messageBus.registerAgent(this);
  }

  subscribe(event: string, callback: (...args: any[]) => void): void {
    this.messageBus.subscribe(event, callback);
  }

  unsubscribe(event: string, callback: (...args: any[]) => void): void {
    this.messageBus.unsubscribe(event, callback);
  }

  publish(event: string, data: any): void {
    this.messageBus.publish(event, data);
  }

  dispose(): void {
    this.messageBus.unregisterAgent(this.id);
  }
}

export default Agent;
