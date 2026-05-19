import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";
import LocalExecutionPermissionCard from "../LocalExecutionPermissionCard";

describe("LocalExecutionPermissionCard", () => {
  const mockProps = {
    command: 'grep -rnli "term" "/path/to/dir"',
    shellType: "Bash" as const,
    reason: "Need to search for files on the local machine",
    agentName: "EverFern",
    onDeny: vi.fn(),
    onAlwaysAllow: vi.fn(),
    onAllowOnce: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render the card with correct structure", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);

      // Check for main card
      const card = screen.getByRole("button", { name: /Deny/i }).closest("div");
      expect(card).toBeInTheDocument();
    });

    it("should display the terminal icon", () => {
      const { container } = render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(container.textContent).toContain("⊡");
    });

    it("should display the header text with agent name", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(
        screen.getByText("Allow EverFern to execute commands locally?")
      ).toBeInTheDocument();
    });

    it("should display the shell type label", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(screen.getByText("Bash")).toBeInTheDocument();
    });

    it("should display the command in the code block", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(screen.getByText(mockProps.command)).toBeInTheDocument();
    });

    it("should display the reason text", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(
        screen.getByText(/Need to search for files on the local machine/)
      ).toBeInTheDocument();
    });

    it("should render all three buttons", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(screen.getByRole("button", { name: /Deny local execution/i })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Always allow local execution/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Allow local execution once/i })
      ).toBeInTheDocument();
    });

    it("should display the amber notice with agent name", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      expect(
        screen.getByText("EverFern will continue working after your reply")
      ).toBeInTheDocument();
    });

    it("should render spinner SVG in the notice", () => {
      const { container } = render(
        <LocalExecutionPermissionCard {...mockProps} />
      );
      const spinner = container.querySelector("svg");
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveClass("animate-spin");
    });
  });

  describe("Button Callbacks", () => {
    it("should call onDeny when Deny button is clicked", async () => {
      const user = userEvent.setup();
      const onDeny = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onDeny={onDeny}
        />
      );

      const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
      await user.click(denyButton);

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it("should call onAlwaysAllow when Always allow button is clicked", async () => {
      const user = userEvent.setup();
      const onAlwaysAllow = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onAlwaysAllow={onAlwaysAllow}
        />
      );

      const alwaysAllowButton = screen.getByRole("button", {
        name: /Always allow local execution/i,
      });
      await user.click(alwaysAllowButton);

      expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
    });

    it("should call onAllowOnce when Allow once button is clicked", async () => {
      const user = userEvent.setup();
      const onAllowOnce = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onAllowOnce={onAllowOnce}
        />
      );

      const allowOnceButton = screen.getByRole("button", {
        name: /Allow local execution once/i,
      });
      await user.click(allowOnceButton);

      expect(onAllowOnce).toHaveBeenCalledTimes(1);
    });

    it("should not call any callback when component renders", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);

      expect(mockProps.onDeny).not.toHaveBeenCalled();
      expect(mockProps.onAlwaysAllow).not.toHaveBeenCalled();
      expect(mockProps.onAllowOnce).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard Navigation", () => {
    it("should trigger Deny button with Enter key", async () => {
      const user = userEvent.setup();
      const onDeny = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onDeny={onDeny}
        />
      );

      const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
      denyButton.focus();
      await user.keyboard("{Enter}");

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it("should trigger Deny button with Space key", async () => {
      const user = userEvent.setup();
      const onDeny = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onDeny={onDeny}
        />
      );

      const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
      denyButton.focus();
      await user.keyboard(" ");

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it("should trigger Always allow button with Enter key", async () => {
      const user = userEvent.setup();
      const onAlwaysAllow = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onAlwaysAllow={onAlwaysAllow}
        />
      );

      const alwaysAllowButton = screen.getByRole("button", {
        name: /Always allow local execution/i,
      });
      alwaysAllowButton.focus();
      await user.keyboard("{Enter}");

      expect(onAlwaysAllow).toHaveBeenCalledTimes(1);
    });

    it("should trigger Allow once button with Space key", async () => {
      const user = userEvent.setup();
      const onAllowOnce = vi.fn();
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          onAllowOnce={onAllowOnce}
        />
      );

      const allowOnceButton = screen.getByRole("button", {
        name: /Allow local execution once/i,
      });
      allowOnceButton.focus();
      await user.keyboard(" ");

      expect(onAllowOnce).toHaveBeenCalledTimes(1);
    });

    it("should allow Tab navigation between buttons", async () => {
      const user = userEvent.setup();
      render(<LocalExecutionPermissionCard {...mockProps} />);

      const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
      const alwaysAllowButton = screen.getByRole("button", {
        name: /Always allow local execution/i,
      });
      const allowOnceButton = screen.getByRole("button", {
        name: /Allow local execution once/i,
      });

      denyButton.focus();
      expect(denyButton).toHaveFocus();

      await user.keyboard("{Tab}");
      expect(alwaysAllowButton).toHaveFocus();

      await user.keyboard("{Tab}");
      expect(allowOnceButton).toHaveFocus();
    });
  });

  describe("ARIA Labels", () => {
    it("should have aria-label on Deny button", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
      expect(denyButton).toHaveAttribute(
        "aria-label",
        "Deny local execution"
      );
    });

    it("should have aria-label on Always allow button", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      const alwaysAllowButton = screen.getByRole("button", {
        name: /Always allow local execution/i,
      });
      expect(alwaysAllowButton).toHaveAttribute(
        "aria-label",
        "Always allow local execution for this session"
      );
    });

    it("should have aria-label on Allow once button", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      const allowOnceButton = screen.getByRole("button", {
        name: /Allow local execution once/i,
      });
      expect(allowOnceButton).toHaveAttribute(
        "aria-label",
        "Allow local execution once"
      );
    });
  });

  describe("Different Shell Types", () => {
    it("should display PowerShell label when shellType is PowerShell", () => {
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          shellType="PowerShell"
        />
      );
      expect(screen.getByText("PowerShell")).toBeInTheDocument();
    });

    it("should display Bash label when shellType is Bash", () => {
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          shellType="Bash"
        />
      );
      expect(screen.getByText("Bash")).toBeInTheDocument();
    });
  });

  describe("Different Commands", () => {
    it("should handle long commands with line wrapping", () => {
      const longCommand =
        'find /path/to/search -type f -name "*.txt" -exec grep -l "pattern" {} \\; | head -20';
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          command={longCommand}
        />
      );
      expect(screen.getByText(longCommand)).toBeInTheDocument();
    });

    it("should handle commands with special characters", () => {
      const specialCommand = 'echo "Hello $USER" && ls -la | grep "^d"';
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          command={specialCommand}
        />
      );
      expect(screen.getByText(specialCommand)).toBeInTheDocument();
    });

    it("should handle multiline commands", () => {
      const multilineCommand = `for file in *.txt; do
  echo "Processing $file"
  cat "$file"
done`;
      const { container } = render(
        <LocalExecutionPermissionCard
          {...mockProps}
          command={multilineCommand}
        />
      );
      // Check that the code element contains the command
      const codeElement = container.querySelector("code");
      expect(codeElement?.textContent).toContain("for file in *.txt");
      expect(codeElement?.textContent).toContain("Processing");
    });
  });

  describe("Different Agent Names", () => {
    it("should display custom agent name in header", () => {
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          agentName="CustomAgent"
        />
      );
      expect(
        screen.getByText("Allow CustomAgent to execute commands locally?")
      ).toBeInTheDocument();
    });

    it("should display custom agent name in notice", () => {
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          agentName="Manus"
        />
      );
      expect(
        screen.getByText("Manus will continue working after your reply")
      ).toBeInTheDocument();
    });
  });

  describe("Styling and Layout", () => {
    it("should have correct card styling classes", () => {
      const { container } = render(
        <LocalExecutionPermissionCard {...mockProps} />
      );
      const card = container.querySelector(".bg-white.rounded-xl");
      expect(card).toBeInTheDocument();
      expect(card).toHaveClass("border", "border-[#e5e7eb]", "shadow-sm", "p-4");
    });

    it("should have correct code block styling", () => {
      const { container } = render(
        <LocalExecutionPermissionCard {...mockProps} />
      );
      const codeBlock = container.querySelector(".bg-\\[\\#f9fafb\\]");
      expect(codeBlock).toBeInTheDocument();
    });

    it("should have correct button styling for Deny and Always allow", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
      const alwaysAllowButton = screen.getByRole("button", {
        name: /Always allow local execution/i,
      });

      expect(denyButton).toHaveClass("border", "border-[#e5e7eb]");
      expect(alwaysAllowButton).toHaveClass("border", "border-[#e5e7eb]");
    });

    it("should have correct button styling for Allow once", () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);
      const allowOnceButton = screen.getByRole("button", {
        name: /Allow local execution once/i,
      });

      expect(allowOnceButton).toHaveClass("bg-[#1a1a1a]", "text-white");
    });

    it("should have correct notice styling", () => {
      const { container } = render(
        <LocalExecutionPermissionCard {...mockProps} />
      );
      const notice = container.querySelector(".text-amber-500");
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveClass("text-sm", "italic");
    });
  });

  describe("Focus Management", () => {
    it("should auto-focus the Deny button on mount", async () => {
      render(<LocalExecutionPermissionCard {...mockProps} />);

      await waitFor(() => {
        const denyButton = screen.getByRole("button", { name: /Deny local execution/i });
        expect(denyButton).toHaveFocus();
      });
    });
  });

  describe("Snapshot Tests", () => {
    it("should match snapshot with default props", () => {
      const { container } = render(
        <LocalExecutionPermissionCard {...mockProps} />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it("should match snapshot with PowerShell", () => {
      const { container } = render(
        <LocalExecutionPermissionCard
          {...mockProps}
          shellType="PowerShell"
          command="Get-ChildItem -Path C:\\ -Recurse"
        />
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it("should match snapshot with long command", () => {
      const { container } = render(
        <LocalExecutionPermissionCard
          {...mockProps}
          command="find /path/to/search -type f -name '*.txt' -exec grep -l 'pattern' {} \\; | head -20"
        />
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty reason gracefully", () => {
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          reason=""
        />
      );
      // Should not render reason section if empty
      expect(screen.queryByText(/^Reason:/)).not.toBeInTheDocument();
    });

    it("should handle very long agent name", () => {
      const longAgentName = "VeryLongAgentNameThatShouldStillFitInTheHeader";
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          agentName={longAgentName}
        />
      );
      expect(
        screen.getByText(
          `Allow ${longAgentName} to execute commands locally?`
        )
      ).toBeInTheDocument();
    });

    it("should handle command with special characters", () => {
      const specialCommand = 'echo "Hello $USER" && ls -la | grep "^d"';
      render(
        <LocalExecutionPermissionCard
          {...mockProps}
          command={specialCommand}
        />
      );
      expect(screen.getByText(specialCommand)).toBeInTheDocument();
    });
  });
});
