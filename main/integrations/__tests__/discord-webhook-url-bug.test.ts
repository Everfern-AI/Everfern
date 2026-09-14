/**
 * Bug Condition Exploration Test: Discord Configuration Schema Incorrectly Includes webhookUrl
 *
 * Property 1: Bug Condition - Discord Configuration Schema Correctness
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 *
 * GOAL: Surface counterexamples that demonstrate Discord config incorrectly includes webhookUrl field
 *
 * Expected Behavior: Discord configuration SHALL NOT include webhookUrl field
 * Preservation: Telegram configuration SHALL continue to include webhookUrl field
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Discord Configuration Schema - Bug Condition Exploration', () => {
  it('should NOT include webhookUrl field in Discord configuration in main.ts', () => {
    // Read the main.ts file
    const mainTsPath = path.join(__dirname, '../../main.ts');
    const mainTsContent = fs.readFileSync(mainTsPath, 'utf-8');

    // Check if Discord configuration includes webhookUrl
    // This regex looks for the discord config block and checks for webhookUrl
    const discordConfigMatch = mainTsContent.match(/discord:\s*\{[^}]*\}/s);

    expect(discordConfigMatch).toBeDefined();

    if (discordConfigMatch) {
      const discordConfig = discordConfigMatch[0];

      // This assertion will FAIL on unfixed code (proving the bug exists)
      // It will PASS after the fix is implemented
      expect(discordConfig).not.toContain('webhookUrl');
    }
  });

  it('should NOT include webhookUrl field in DiscordConfig component interface', () => {
    // Read the DiscordConfig.tsx file
    const discordConfigPath = path.join(__dirname, '../../../src/components/DiscordConfig.tsx');
    const discordConfigContent = fs.readFileSync(discordConfigPath, 'utf-8');

    // Check if DiscordConfigProps interface includes webhookUrl
    const interfaceMatch = discordConfigContent.match(/interface\s+DiscordConfigProps\s*\{[^}]*config:\s*\{[^}]*\}/s);

    expect(interfaceMatch).toBeDefined();

    if (interfaceMatch) {
      const configInterface = interfaceMatch[0];

      // This assertion will FAIL on unfixed code (proving the bug exists)
      // It will PASS after the fix is implemented
      expect(configInterface).not.toContain('webhookUrl');
    }
  });

  it('PRESERVATION: Telegram configuration SHOULD include webhookUrl field', () => {
    // Read the main.ts file
    const mainTsPath = path.join(__dirname, '../../main.ts');
    const mainTsContent = fs.readFileSync(mainTsPath, 'utf-8');

    // Check if Telegram configuration includes webhookUrl
    const telegramConfigMatch = mainTsContent.match(/telegram:\s*\{[^}]*\}/s);

    expect(telegramConfigMatch).toBeDefined();

    if (telegramConfigMatch) {
      const telegramConfig = telegramConfigMatch[0];

      // This assertion should PASS on both unfixed and fixed code
      // Telegram MUST keep webhookUrl field
      expect(telegramConfig).toContain('webhookUrl');
    }
  });
});
