// @ts-nocheck
import MessageBus from './index';
import Agent from './agent';

describe('MessageBus', () => {
  let messageBus: MessageBus;

  beforeEach(() => {
    messageBus = new MessageBus();
  });

  it('should register and unregister agents', () => {
    const agent1 = new Agent('agent1', 'Agent 1', messageBus);
    const agent2 = new Agent('agent2', 'Agent 2', messageBus);

    expect(messageBus.agentRegistry.size).toBe(2);

    agent1.dispose();
    expect(messageBus.agentRegistry.size).toBe(1);
  });

  it('should publish and subscribe to events', () => {
    const agent1 = new Agent('agent1', 'Agent 1', messageBus);
    const agent2 = new Agent('agent2', 'Agent 2', messageBus);

    const mockCallback = jest.fn();
    agent1.subscribe('test-event', mockCallback);

    agent2.publish('test-event', { data: 'hello' });
    expect(mockCallback).toHaveBeenCalledWith({ data: 'hello' });
  });
});
