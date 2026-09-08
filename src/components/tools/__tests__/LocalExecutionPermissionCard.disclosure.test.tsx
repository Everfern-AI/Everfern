/**
 * DOM-free verification for the "Always allow" session-scope disclosure (audit CU-ST-04).
 *
 * Uses react-dom/server so it runs in the node environment — required because the
 * jsdom environment is broken in this workspace (require('jsdom') hangs).
 *
 * Verifies, for BOTH card copies:
 *   1. The Always-allow button's aria-label is
 *      "Always allow local execution for this session".
 *   2. The visible scope disclosure text is rendered:
 *      "applies to all commands in this chat until you switch conversations".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
      const { initial, animate, exit, transition, ...rest } = props as Record<string, unknown>;
      void initial; void animate; void exit; void transition;
      return React.createElement("div", rest as React.HTMLAttributes<HTMLDivElement>, children);
    },
  },
}));

import ChatCard from "../../../app/chat/components/LocalExecutionPermissionCard";
import ToolsCard from "../LocalExecutionPermissionCard";

const DISCLOSURE_SNIPPET = "applies to all commands in this chat until you switch conversations";
const ARIA_LABEL = "Always allow local execution for this session";

describe.each([
  ["src/app/chat/components/LocalExecutionPermissionCard", ChatCard],
  ["src/components/tools/LocalExecutionPermissionCard", ToolsCard],
])("%s — Always-allow scope disclosure", (_name, Card) => {
  const baseProps = {
    command: 'grep -rnli "term" "/path/to/dir"',
    shellType: "Bash",
    reason: "Need to search for files on the local machine",
    agentName: "EverFern",
    onDeny: vi.fn(),
    onAlwaysAllow: vi.fn(),
    onAllowOnce: vi.fn(),
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Always-allow button has aria-label "Always allow local execution for this session"', () => {
    // @ts-expect-error — the two cards accept slightly different prop unions; props above are valid for both
    const html = renderToStaticMarkup(React.createElement(Card, baseProps));
    expect(html).toContain(`aria-label="${ARIA_LABEL}"`);
  });

  it("renders the visible session-scope disclosure next to the Always allow button", () => {
    // @ts-expect-error — see above
    const html = renderToStaticMarkup(React.createElement(Card, baseProps));
    expect(html).toContain(DISCLOSURE_SNIPPET);
  });

  it("disclosure sits in the button row area, after the buttons (order sanity)", () => {
    // @ts-expect-error — see above
    const html = renderToStaticMarkup(React.createElement(Card, baseProps));
    const alwaysIdx = html.indexOf(ARIA_LABEL);
    const disclosureIdx = html.indexOf(DISCLOSURE_SNIPPET);
    expect(alwaysIdx).toBeGreaterThan(-1);
    expect(disclosureIdx).toBeGreaterThan(alwaysIdx);
  });
});
