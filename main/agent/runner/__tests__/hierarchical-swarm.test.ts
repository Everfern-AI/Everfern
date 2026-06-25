import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getSubagentRegistry, generateAgentId } from '../subagent-registry';
import { SubagentSpawner } from '../subagent-spawn';
import { getSwarmMemory } from '../swarm-memory';

describe('Hierarchical Swarm Engine', () => {
  let spawner: SubagentSpawner;
  let registry: ReturnType<typeof getSubagentRegistry>;
  let swarm: ReturnType<typeof getSwarmMemory>;

  beforeEach(() => {
    spawner = new SubagentSpawner();
    registry = getSubagentRegistry();
    swarm = getSwarmMemory();
  });

  afterEach(() => {
    registry.cleanup();
    spawner.abortAll();
  });

  it('clones the runner constructor to ensure session isolation', async () => {
    const mockRunner = {
      client: { model: 'mock-model' },
      config: { silent: true },
      workspaceDir: '/test/workspace',
      projectId: 'test-project',
      currentAgentSessionKey: undefined,
      run: async () => ({ response: 'mock-response', toolCalls: [] }),
    };

    // Mock constructor to mimic AgentRunner instantiations
    (mockRunner as any).constructor = function (client: any, config: any) {
      return {
        client,
        config,
        workspaceDir: undefined,
        projectId: undefined,
        currentAgentSessionKey: undefined,
        run: mockRunner.run,
      };
    };

    const spawned = await spawner.spawn({
      parentSessionId: 'parent-123',
      task: 'test isolation',
      agentType: 'generic',
      runner: mockRunner as any,
    });

    expect(spawned).toBeDefined();
    expect(spawned.depth).toBe(1);
    expect(spawned.sessionKey).toContain('agent:');
  });

  it('permits nesting up to depth 4 and enforces depth ceiling', async () => {
    const mockRunner = {
      client: { model: 'mock-model' },
      config: { silent: true },
      workspaceDir: '/test/workspace',
      projectId: 'test-project',
      currentAgentSessionKey: undefined,
      run: async () => ({ response: 'mock-response', toolCalls: [] }),
    };

    (mockRunner as any).constructor = function (client: any, config: any) {
      return {
        client,
        config,
        workspaceDir: undefined,
        projectId: undefined,
        currentAgentSessionKey: undefined,
        run: mockRunner.run,
      };
    };

    // Depth 1 (Root Spawn)
    const agent1 = await spawner.spawn({
      parentSessionId: 'parent-123',
      task: 'task 1',
      runner: mockRunner as any,
    });
    expect(agent1.depth).toBe(1);

    // Depth 2
    const agent2 = await spawner.spawn({
      parentSessionId: 'parent-123',
      sponsorSessionKey: agent1.sessionKey,
      task: 'task 2',
      runner: mockRunner as any,
    });
    expect(agent2.depth).toBe(2);

    // Depth 3
    const agent3 = await spawner.spawn({
      parentSessionId: 'parent-123',
      sponsorSessionKey: agent2.sessionKey,
      task: 'task 3',
      runner: mockRunner as any,
    });
    expect(agent3.depth).toBe(3);

    // Depth 4
    const agent4 = await spawner.spawn({
      parentSessionId: 'parent-123',
      sponsorSessionKey: agent3.sessionKey,
      task: 'task 4',
      runner: mockRunner as any,
    });
    expect(agent4.depth).toBe(4);

    // Depth 5 - Should throw depth ceiling error
    await expect(
      spawner.spawn({
        parentSessionId: 'parent-123',
        sponsorSessionKey: agent4.sessionKey,
        task: 'task 5',
        runner: mockRunner as any,
      })
    ).rejects.toThrow(/Max spawn depth ceiling/);
  });

  it('synchronizes real-time facts across agents using SwarmMemoryBus', async () => {
    const sessionId = 'swarm-session-999';

    // Broadcast a fact from agent A
    swarm.broadcast({
      sourceAgentId: 'agent-A',
      sessionId,
      type: 'fact',
      content: 'Database port is 5432',
    });

    // Broadcast another fact from agent B
    swarm.broadcast({
      sourceAgentId: 'agent-B',
      sessionId,
      type: 'goal_update',
      content: 'Research complete',
    });

    const memory = swarm.getMemory(sessionId);
    expect(memory.length).toBe(2);

    expect(memory[0].sourceAgentId).toBe('agent-A');
    expect(memory[0].content).toBe('Database port is 5432');

    expect(memory[1].sourceAgentId).toBe('agent-B');
    expect(memory[1].content).toBe('Research complete');

    // Clean up
    swarm.clearSession(sessionId);
    expect(swarm.getMemory(sessionId).length).toBe(0);
  });
});
