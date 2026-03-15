// @ts-nocheck
import type { Request, Response } from 'express';
import { Agent, AgentStatus } from '../types';

let agents: Agent[] = [];

export const getAgents = (req: Request, res: Response) => {
  res.status(200).json(agents);
};

export const spawnAgent = (agent: Agent) => {
  agents.push(agent);
};

export const getAgentStatus = (agentId: string): AgentStatus => {
  const agent = agents.find((a) => a.id === agentId);
  return agent?.status || AgentStatus.OFFLINE;
};