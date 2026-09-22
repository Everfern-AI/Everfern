import { describe, it, expect } from "vitest";
import {
  pruneHistoricalScreenshots,
  computeScreenHash,
  isIrreversibleAction,
  PRUNED_SCREENSHOT_PLACEHOLDER,
  SYSTEM_PROMPT,
  DEFAULT_COMPUTER_USE_SYSTEM_PROMPT,
  parseOutput,
  parseJsonAction,
  buildQwenMessages,
} from "../computer-use";
import type { ChatMessage } from "../../../lib/ai-client";

describe("Computer Use - Screenshot Pruning & Prefix Caching", () => {
  it("keeps the last N screenshots and replaces older ones with the constant placeholder", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Task: click the button" },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_1" } },
        ],
      },
      {
        role: "assistant",
        content: "Clicking button 1",
        tool_calls: [{ id: "tc-1", type: "function", function: { name: "click_at", arguments: "{}" } }],
      },
      {
        role: "tool",
        tool_call_id: "tc-1",
        content: [
          { type: "text", text: '{"status":"success"}' },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_2" } },
        ],
      },
      {
        role: "assistant",
        content: "Clicking button 2",
        tool_calls: [{ id: "tc-2", type: "function", function: { name: "click_at", arguments: "{}" } }],
      },
      {
        role: "tool",
        tool_call_id: "tc-2",
        content: [
          { type: "text", text: '{"status":"success"}' },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_3" } },
        ],
      },
    ];

    // Total 3 screenshots. Keep last 2.
    const result = pruneHistoricalScreenshots(messages, 2);

    expect(result.prunedCount).toBe(1);
    expect(result.oldestActiveIndex).toBe(2); // Screenshot 2 is in messages[2]

    // Screenshot 1 in messages[0] should be pruned
    const userContent = messages[0].content as any[];
    expect(userContent[0]).toEqual({ type: "text", text: "Task: click the button" });
    expect(userContent[1]).toEqual({
      type: "text",
      text: PRUNED_SCREENSHOT_PLACEHOLDER,
    });

    // Screenshot 2 in messages[2] should remain active
    const toolContent1 = messages[2].content as any[];
    expect(toolContent1[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,SCREENSHOT_2" },
    });

    // Screenshot 3 in messages[4] should remain active
    const toolContent2 = messages[4].content as any[];
    expect(toolContent2[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,SCREENSHOT_3" },
    });
  });

  it("guarantees 100% byte-identity of the pruned prefix across sequential turns", () => {
    // Simulate Turn 3 state:
    // Turn 1 screenshot pruned to placeholder
    // Turn 2 screenshot active
    // Turn 3 screenshot active
    const turn3Messages: ChatMessage[] = [
      { role: "system", content: "You are a desktop agent." },
      {
        role: "user",
        content: [
          { type: "text", text: "Task: Complete workflow" },
          { type: "text", text: PRUNED_SCREENSHOT_PLACEHOLDER },
        ],
      },
      {
        role: "assistant",
        content: "Action 1",
        tool_calls: [{ id: "tc-1", type: "function", function: { name: "click_at", arguments: "{}" } }],
      },
      {
        role: "tool",
        tool_call_id: "tc-1",
        content: [
          { type: "text", text: '{"status":"success"}' },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_2" } },
        ],
      },
      {
        role: "assistant",
        content: "Action 2",
        tool_calls: [{ id: "tc-2", type: "function", function: { name: "click_at", arguments: "{}" } }],
      },
      {
        role: "tool",
        tool_call_id: "tc-2",
        content: [
          { type: "text", text: '{"status":"success"}' },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_3" } },
        ],
      },
    ];

    // Simulate Turn 4 state:
    // Turn 1 screenshot remains pruned with the constant placeholder
    // Turn 2 screenshot now gets pruned
    // Turn 3 screenshot remains active
    // Turn 4 screenshot is added and active
    const turn4Messages: ChatMessage[] = JSON.parse(JSON.stringify(turn3Messages));
    turn4Messages.push(
      {
        role: "assistant",
        content: "Action 3",
        tool_calls: [{ id: "tc-3", type: "function", function: { name: "click_at", arguments: "{}" } }],
      },
      {
        role: "tool",
        tool_call_id: "tc-3",
        content: [
          { type: "text", text: '{"status":"success"}' },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_4" } },
        ],
      }
    );

    // Prune Turn 4 messages (now 3 screenshots: SCREENSHOT_2, SCREENSHOT_3, SCREENSHOT_4)
    pruneHistoricalScreenshots(turn4Messages, 2);

    // The prefix consisting of messages[0], messages[1], messages[2] must be 100% byte-identical
    const prefixTurn3 = JSON.stringify(turn3Messages.slice(0, 3));
    const prefixTurn4 = JSON.stringify(turn4Messages.slice(0, 3));

    expect(prefixTurn4).toBe(prefixTurn3);
  });

  it("does nothing when total screenshots are <= keepLastN", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Task: click" },
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_1" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,SCREENSHOT_2" } },
        ],
      },
    ];

    const result = pruneHistoricalScreenshots(messages, 2);
    expect(result.prunedCount).toBe(0);
    expect(result.oldestActiveIndex).toBe(0);

    const userContent = messages[0].content as any[];
    expect(userContent[1].image_url.url).toBe("data:image/png;base64,SCREENSHOT_1");
  });
});

describe("Computer Use - Screen State Hashing", () => {
  it("produces identical SHA-256 hashes for identical screenshot base64 strings", () => {
    const imgA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const imgB = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const hashA = computeScreenHash(imgA);
    const hashB = computeScreenHash(imgB);

    expect(hashA).toBe(hashB);
    expect(hashA.length).toBe(64); // SHA-256 hex length
  });

  it("produces different hashes for different screenshots", () => {
    const imgA = "data:image/png;base64,AAA111222333";
    const imgB = "data:image/png;base64,BBB444555666";

    expect(computeScreenHash(imgA)).not.toBe(computeScreenHash(imgB));
  });

  it("returns empty string for empty input", () => {
    expect(computeScreenHash("")).toBe("");
  });
});

describe("Computer Use - Irreversible Action Detection", () => {
  it("flags destructive or financial keywords as irreversible", () => {
    expect(isIrreversibleAction("click_at", { text: "Submit Order" })).toBe(true);
    expect(isIrreversibleAction("click", { label: "Pay Now" })).toBe(true);
    expect(isIrreversibleAction("left_click", { button: "Delete Account" })).toBe(true);
    expect(isIrreversibleAction("type", { text: "drop database users" })).toBe(true);
    expect(isIrreversibleAction("terminate", { reason: "done" })).toBe(true);
    expect(isIrreversibleAction("purchase", {})).toBe(true);
  });

  it("does not flag routine navigational actions", () => {
    expect(isIrreversibleAction("click_at", { x: 100, y: 200 })).toBe(false);
    expect(isIrreversibleAction("mouse_move", { x: 500, y: 500 })).toBe(false);
    expect(isIrreversibleAction("type", { text: "Hello World" })).toBe(false);
    expect(isIrreversibleAction("scroll", { pixels: -500 })).toBe(false);
    expect(isIrreversibleAction("zoom", { coordinate: [100, 200] })).toBe(false);
    expect(isIrreversibleAction("wait", { time: 5 })).toBe(false);
  });
});

describe("Computer Use - Simple Prompt & JSON Output Parsing (qwen.py style)", () => {
  it("includes normalized 0-1000 coordinates and clean rules in SYSTEM_PROMPT", () => {
    expect(SYSTEM_PROMPT).toContain("NORMALIZED 0-1000");
    expect(SYSTEM_PROMPT).toContain('{"thought": "<one short sentence>", "action": "<action>", ...params}');
    expect(SYSTEM_PROMPT).toContain('"action":"click"');
    expect(SYSTEM_PROMPT).toContain('"action":"type"');
    expect(SYSTEM_PROMPT).toContain('"action":"key"');
    expect(SYSTEM_PROMPT).toContain('"action":"done"');
  });

  it("includes clean tool-calling rules in DEFAULT_COMPUTER_USE_SYSTEM_PROMPT", () => {
    expect(DEFAULT_COMPUTER_USE_SYSTEM_PROMPT).toContain("NORMALIZED 0-1000");
    expect(DEFAULT_COMPUTER_USE_SYSTEM_PROMPT).toContain("left_click");
    expect(DEFAULT_COMPUTER_USE_SYSTEM_PROMPT).toContain("type");
    expect(DEFAULT_COMPUTER_USE_SYSTEM_PROMPT).toContain("zoom");
  });

  it("parses clean qwen.py JSON click actions", () => {
    const raw = '{"thought": "Clicking the Brave icon", "action": "click", "x": 250, "y": 800}';
    const parsed = parseOutput(raw);
    expect(parsed.thought).toBe("Clicking the Brave icon");
    expect(parsed.actions).toEqual(["click(250,800)"]);
  });

  it("parses clean qwen.py JSON type, key, scroll, zoom, and done actions", () => {
    expect(parseOutput('{"thought": "Typing Brave", "action": "type", "text": "Brave"}').actions)
      .toEqual(['type("Brave")']);

    expect(parseOutput('{"thought": "Pressing Win key", "action": "key", "keys": ["win"]}').actions)
      .toEqual(['press(win)']);

    expect(parseOutput('{"thought": "Scrolling down", "action": "scroll", "amount": -5}').actions)
      .toEqual(['scroll(down)']);

    expect(parseOutput('{"thought": "Scrolling up", "action": "scroll", "amount": 5}').actions)
      .toEqual(['scroll(up)']);

    expect(parseOutput('{"thought": "Zooming into icon", "action": "zoom", "x": 100, "y": 200}').actions)
      .toEqual(['zoom(100,200)']);

    expect(parseOutput('{"thought": "Task complete", "action": "done", "summary": "Browser set to Brave"}').actions)
      .toEqual(['finished()']);
  });

  it("handles markdown code fences around JSON", () => {
    const raw = '```json\n{"thought": "Opening start menu", "action": "key", "keys": ["win"]}\n```';
    const parsed = parseOutput(raw);
    expect(parsed.thought).toBe("Opening start menu");
    expect(parsed.actions).toEqual(["press(win)"]);
  });

  it("parseJsonAction validates actions and normalized coordinates", () => {
    const validClick = parseJsonAction('{"thought": "Click button", "action": "click", "x": 500, "y": 600}');
    expect(validClick.error).toBeNull();
    expect(validClick.action).toEqual({
      thought: "Click button",
      action: "click",
      x: 500,
      y: 600,
    });

    const outOfBounds = parseJsonAction('{"action": "click", "x": 1500, "y": 600}');
    expect(outOfBounds.action).toBeNull();
    expect(outOfBounds.error).toContain("x and y must be normalized 0-1000");

    const nonJson = parseJsonAction("I will click the button now");
    expect(nonJson.action).toBeNull();
    expect(nonJson.error).toContain("Your reply was not a JSON object");
  });

  it("buildQwenMessages creates cache-friendly conversation with pruned screenshots", () => {
    const history = [
      {
        obs_text: "Task: Search Brave\nStep 1. Current screenshot:",
        image: "data:image/webp;base64,IMG1",
        reply: '{"thought": "Pressing win", "action": "key", "keys": ["win"]}',
      },
      {
        obs_text: "Result of your previous action: Pressed win.\nStep 2. Current screenshot:",
        image: "data:image/webp;base64,IMG2",
        reply: '{"thought": "Typing Brave", "action": "type", "text": "Brave"}',
      },
    ];

    const currentObs = "Result of your previous action: Typed 5 characters.\nStep 3. Current screenshot:";
    const currentImg = "data:image/webp;base64,IMG3";

    const messages = buildQwenMessages(history, currentObs, currentImg, 2);

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(SYSTEM_PROMPT);

    // Turn 1 (pruned because keepLastScreenshots=2 and we have 3 total screenshots)
    expect(messages[1].role).toBe("user");
    const turn1Content = messages[1].content as any[];
    expect(turn1Content[0].text).toContain(PRUNED_SCREENSHOT_PLACEHOLDER);
    expect(turn1Content.some(p => p.type === "image_url")).toBe(false);

    expect(messages[2].role).toBe("assistant");
    expect(messages[2].content).toBe(history[0].reply);

    // Turn 2 (active screenshot)
    expect(messages[3].role).toBe("user");
    const turn2Content = messages[3].content as any[];
    expect(turn2Content.some(p => p.type === "image_url")).toBe(true);

    expect(messages[4].role).toBe("assistant");
    expect(messages[4].content).toBe(history[1].reply);

    // Turn 3 (current screenshot)
    expect(messages[5].role).toBe("user");
    const turn3Content = messages[5].content as any[];
    expect(turn3Content[0].text).toBe(currentObs);
    expect(turn3Content[1].image_url.url).toBe(currentImg);
  });
});
