/**
 * Example usage of PlanArtifact component
 *
 * This file demonstrates how to use the new muted minimal plan artifact.
 */

import { PlanArtifact, PlanArtifactCompact } from "./PlanArtifact";

// Example 1: Full plan with all features
export function ExampleFullPlan() {
  return (
    <PlanArtifact
      title="Website Redesign Plan"
      description="A comprehensive plan to redesign the company website with modern aesthetics and improved UX."
      steps={[
        {
          id: "1",
          title: "Audit current website",
          description: "Review existing pages and identify pain points",
          status: "completed",
        },
        {
          id: "2",
          title: "Create wireframes",
          description: "Design low-fidelity layouts for key pages",
          status: "completed",
        },
        {
          id: "3",
          title: "Design high-fidelity mockups",
          description: "Create polished designs in Figma",
          status: "in_progress",
        },
        {
          id: "4",
          title: "Develop frontend components",
          description: "Build React components based on designs",
          status: "pending",
        },
        {
          id: "5",
          title: "Integrate with backend",
          description: "Connect frontend to existing APIs",
          status: "pending",
        },
      ]}
      meta={{
        estimatedTime: "~2 weeks",
        tools: ["Figma", "React", "TypeScript"],
        complexity: "medium",
      }}
      onApprove={() => console.log("Approved!")}
      onEdit={() => console.log("Edit clicked")}
    />
  );
}

// Example 2: Simple plan without meta
export function ExampleSimplePlan() {
  return (
    <PlanArtifact
      title="Quick Task List"
      steps={[
        { id: "1", title: "Review pull request", status: "pending" },
        { id: "2", title: "Update documentation", status: "pending" },
        { id: "3", title: "Deploy to staging", status: "pending" },
      ]}
      onApprove={() => console.log("Approved!")}
    />
  );
}

// Example 3: Compact inline version
export function ExampleCompactPlan() {
  return (
    <PlanArtifactCompact
      title="Execution Plan"
      stepCount={5}
      completedCount={2}
      onClick={() => console.log("Open full plan")}
    />
  );
}

// Example 4: Dark mode preview
export function ExampleDarkMode() {
  return (
    <div className="dark bg-stone-950 p-6">
      <PlanArtifact
        title="Dark Mode Plan"
        description="This shows how the component looks in dark mode."
        steps={[
          { id: "1", title: "First step completed", status: "completed" },
          { id: "2", title: "Second step in progress", status: "in_progress" },
          { id: "3", title: "Third step pending", status: "pending" },
        ]}
        meta={{
          estimatedTime: "~3 days",
          tools: ["Node.js"],
          complexity: "low",
        }}
        onApprove={() => {}}
        onEdit={() => {}}
      />
    </div>
  );
}
