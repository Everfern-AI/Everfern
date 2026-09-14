import { defineComponent, createLibrary, Library } from "@openuidev/react-lang";
import { z } from "zod/v4";
import React from "react";

// ── Stat Card Component ────────────────────────────────────────────────────────
const StatCard = defineComponent({
  name: "StatCard",
  description: "Display a metric with label, value, and optional trend indicator",
  props: z.object({
    label: z.string(),
    value: z.string(),
    trend: z.string().optional(),
    trendUp: z.boolean().optional(),
    icon: z.string().optional(),
  }),
  component: ({ props }) => (
    <div style={{
      padding: '20px',
      borderRadius: '12px',
      backgroundColor: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-sm)',
      transition: 'transform 0.2s, box-shadow 0.2s',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'none';
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 8px 0', fontWeight: 500 }}>
            {props.label}
          </p>
          <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
            {props.value}
          </p>
        </div>
        {props.icon && (
          <span style={{ fontSize: '24px' }}>{props.icon}</span>
        )}
      </div>
      {props.trend && (
        <div style={{
          marginTop: '12px',
          fontSize: '13px',
          color: props.trendUp ? 'var(--color-success)' : 'var(--color-error)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <span>{props.trendUp ? '↑' : '↓'}</span>
          <span>{props.trend}</span>
        </div>
      )}
    </div>
  ),
});

// ── Card Component ────────────────────────────────────────────────────────────
const Card = defineComponent({
  name: "Card",
  description: "A flexible container card with optional title and children",
  props: z.object({
    title: z.string().optional(),
    children: z.array(z.any()).optional(),
  }),
  component: ({ props, renderNode }) => (
    <div style={{
      padding: '20px',
      borderRadius: '12px',
      backgroundColor: 'var(--color-bg-surface)',
      border: '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-sm)',
      marginBottom: '16px',
    }}>
      {props.title && (
        <h3 style={{
          fontSize: '16px',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          margin: '0 0 16px 0',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--color-border-subtle)'
        }}>
          {props.title}
        </h3>
      )}
      {props.children && renderNode(props.children)}
    </div>
  ),
});

// ── Stack Component (Layout) ─────────────────────────────────────────────────
const Stack = defineComponent({
  name: "Stack",
  description: "Vertical stack layout for arranging components",
  props: z.object({
    children: z.array(z.any()),
    gap: z.string().optional(),
  }),
  component: ({ props, renderNode }) => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: props.gap || '16px',
    }}>
      {renderNode(props.children)}
    </div>
  ),
});

// ── Row Component (Horizontal Layout) ───────────────────────────────────────
const Row = defineComponent({
  name: "Row",
  description: "Horizontal row layout for side-by-side components",
  props: z.object({
    children: z.array(z.any()),
    gap: z.string().optional(),
  }),
  component: ({ props, renderNode }) => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${props.children?.length || 1}, 1fr)`,
      gap: props.gap || '16px',
    }}>
      {renderNode(props.children)}
    </div>
  ),
});

// ── Text Content Component ───────────────────────────────────────────────────
const TextContent = defineComponent({
  name: "TextContent",
  description: "Display text content with optional size variant",
  props: z.object({
    text: z.string(),
    size: z.enum(["small", "medium", "large", "large-heavy"]).optional(),
  }),
  component: ({ props }) => {
    const sizeMap: Record<string, React.CSSProperties> = {
      "small": { fontSize: '13px', color: 'var(--color-text-secondary)' },
      "medium": { fontSize: '15px', color: 'var(--color-text-primary)' },
      "large": { fontSize: '18px', color: 'var(--color-text-primary)' },
      "large-heavy": { fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)' },
    };
    return (
      <p style={{ margin: '8px 0', lineHeight: 1.6, ...sizeMap[props.size || 'medium'] }}>
        {props.text}
      </p>
    );
  },
});

// ── Button Component ─────────────────────────────────────────────────────────
const Button = defineComponent({
  name: "Button",
  description: "Interactive button component",
  props: z.object({
    label: z.string(),
    variant: z.enum(["primary", "secondary", "outline"]).optional(),
    action: z.string().optional(),
  }),
  component: ({ props }) => {
    const variantStyles: Record<string, React.CSSProperties> = {
      "primary": {
        backgroundColor: 'var(--color-info)',
        color: 'var(--color-text-inverse)',
        border: 'none',
      },
      "secondary": {
        backgroundColor: 'var(--color-bg-subtle)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
      },
      "outline": {
        backgroundColor: 'transparent',
        color: 'var(--color-info)',
        border: '1px solid var(--color-info)',
      },
    };
    return (
      <button
        style={{
          padding: '10px 20px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'opacity 0.2s',
          ...variantStyles[props.variant || 'primary'],
        }}
        onClick={() => {
          if (props.action) {
            console.log('Button action:', props.action);
          }
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
      >
        {props.label}
      </button>
    );
  },
});

// ── Progress Bar Component ───────────────────────────────────────────────────
const ProgressBar = defineComponent({
  name: "ProgressBar",
  description: "Visual progress bar showing completion percentage",
  props: z.object({
    label: z.string().optional(),
    value: z.number(),
    max: z.number().optional(),
    color: z.string().optional(),
  }),
  component: ({ props }) => {
    const percentage = Math.min(100, (props.value / (props.max || 100)) * 100);
    return (
      <div style={{ margin: '12px 0' }}>
        {props.label && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>{props.label}</span>
            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{percentage.toFixed(0)}%</span>
          </div>
        )}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--color-bg-subtle)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${percentage}%`,
            height: '100%',
            backgroundColor: props.color || 'var(--color-info)',
            borderRadius: '4px',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>
    );
  },
});

// ── Badge Component ──────────────────────────────────────────────────────────
const Badge = defineComponent({
  name: "Badge",
  description: "Small badge label for status or categories",
  props: z.object({
    text: z.string(),
    variant: z.enum(["success", "warning", "error", "info"]).optional(),
  }),
  component: ({ props }) => {
    const variantStyles: Record<string, React.CSSProperties> = {
      "success": { backgroundColor: 'var(--color-success-dim)', color: 'var(--color-success)' },
      "warning": { backgroundColor: 'var(--color-warning-dim)', color: 'var(--color-warning)' },
      "error": { backgroundColor: 'var(--color-error-dim)', color: 'var(--color-error)' },
      "info": { backgroundColor: 'var(--color-info-dim)', color: 'var(--color-info)' },
    };
    return (
      <span style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 600,
        ...variantStyles[props.variant || 'info'],
      }}>
        {props.text}
      </span>
    );
  },
});

// ── Table Component ─────────────────────────────────────────────────────────
const Table = defineComponent({
  name: "Table",
  description: "Data table with headers and rows",
  props: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  component: ({ props }) => (
    <div style={{ overflowX: 'auto', margin: '16px 0' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '14px',
      }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--color-bg-subtle)', borderBottom: '1px solid var(--color-border)' }}>
            {props.headers.map((header, i) => (
              <th key={i} style={{
                padding: '12px 16px',
                textAlign: 'left',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '12px 16px',
                  color: 'var(--color-text-primary)',
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
});

// ── Divider Component ────────────────────────────────────────────────────────
const Divider = defineComponent({
  name: "Divider",
  description: "Horizontal divider line",
  props: z.object({}),
  component: () => (
    <hr style={{
      border: 'none',
      borderTop: '1px solid var(--color-border)',
      margin: '16px 0',
    }} />
  ),
});

// ── Create Library ──────────────────────────────────────────────────────────
export const uiLibrary: Library = createLibrary({
  root: "Stack",
  components: [
    StatCard,
    Card,
    Stack,
    Row,
    TextContent,
    Button,
    ProgressBar,
    Badge,
    Table,
    Divider,
  ],
});

// ── Generate System Prompt ──────────────────────────────────────────────────
export const getOpenUISystemPrompt = (): string => {
  return uiLibrary.prompt({
    preamble: `You can create beautiful UI dashboards, cards, and visual elements using OpenUI Lang.
When asked to create visual content like dashboards, reports, or cards, use OpenUI code blocks with \`\`\`openui notation.`,
    additionalRules: [
      "Wrap OpenUI code in ```openui ... ``` blocks for proper rendering",
      "Start with root = Stack([...]) as the entry point",
      "Use Row for side-by-side layouts and Stack for vertical arrangements",
      "StatCard is perfect for displaying metrics with trends",
      "Use Card to group related content with optional titles",
    ],
    examples: [
      `root = Stack([
  Row([
    StatCard("Total Revenue", "$48,352", "+12.5%", true, "💰"),
    StatCard("Active Users", "3,287", "+8.2%", true, "👥"),
    StatCard("Conversion", "3.24%", "-0.5%", false, "📊")
  ], "16px"),
  Card("Recent Activity", [
    TextContent("User signups increased 15% this week", "medium"),
    ProgressBar("Goal Progress", 68, 100, "#10b981")
  ])
])`,
    ],
  });
};
