/**
 * App catalogue for the Apps sheet.
 *
 * Third-party apps carry a `domain`; their logo comes from logo.dev (see AppLogo).
 * EverFern's own apps and Google sub-brands carry a `tile` instead, because logo.dev
 * collapses sub-brands to the parent domain (sheets.google.com returns the Google G).
 */

export type AppTile = {
  /** lucide icon name, resolved in AppLogo */
  icon:
    | "folder" | "mail" | "globe" | "search" | "sheet" | "doc" | "slides" | "pdf"
    | "image" | "music" | "pen" | "calendar" | "drive" | "megaphone" | "terminal";
  /** CSS background for the rounded tile */
  bg: string;
  fg?: string;
};

export type AppDef = {
  id: string;
  name: string;
  domain?: string;
  tile?: AppTile;
  blurb: string;
  rating: number;
  ratings: number;
};

export type AppSection = { id: string; title: string; apps: string[] };

const A = (a: AppDef) => a;

export const APPS: Record<string, AppDef> = Object.fromEntries(
  [
    // ── EverFern apps (run inside the worker's computer) ─────────────
    A({ id: "files", name: "Files", tile: { icon: "folder", bg: "linear-gradient(160deg,#6fb7ff,#2f7cf6)" }, blurb: "Browse and organise the worker's files", rating: 5, ratings: 1 }),
    A({ id: "mail", name: "Mail", tile: { icon: "mail", bg: "linear-gradient(160deg,#5ac8fa,#1e88e5)" }, blurb: "Read, sort and send email", rating: 5, ratings: 1 }),
    A({ id: "browser", name: "Browser", tile: { icon: "globe", bg: "linear-gradient(160deg,#4fd1a5,#1f9d74)" }, blurb: "A full web browser the worker can drive", rating: 5, ratings: 3 }),
    A({ id: "websearch", name: "Web search", tile: { icon: "search", bg: "linear-gradient(160deg,#3b3f46,#16181b)" }, blurb: "Search the web and read results", rating: 5, ratings: 2 }),
    A({ id: "sheets", name: "Sheets", tile: { icon: "sheet", bg: "linear-gradient(160deg,#43d17a,#169c4b)" }, blurb: "Spreadsheets with formulas and charts", rating: 4.8, ratings: 4 }),
    A({ id: "docs", name: "Docs", tile: { icon: "doc", bg: "linear-gradient(160deg,#7aa7ff,#3d6df2)" }, blurb: "Write and edit documents", rating: 5, ratings: 1 }),
    A({ id: "slides", name: "Slides", tile: { icon: "slides", bg: "linear-gradient(160deg,#ffb547,#f08a1c)" }, blurb: "Build presentations", rating: 5, ratings: 1 }),
    A({ id: "pdf", name: "PDF", tile: { icon: "pdf", bg: "linear-gradient(160deg,#ff6b6b,#e03131)" }, blurb: "Open, fill and annotate PDFs", rating: 4.9, ratings: 2 }),
    A({ id: "sketch", name: "Sketchbook", tile: { icon: "pen", bg: "linear-gradient(160deg,#c084fc,#7c3aed)" }, blurb: "Quick diagrams and image edits", rating: 5, ratings: 1 }),
    A({ id: "images", name: "Images", tile: { icon: "image", bg: "linear-gradient(160deg,#f472b6,#db2777)" }, blurb: "Generate and edit images", rating: 5, ratings: 1 }),
    A({ id: "audio", name: "Audio", tile: { icon: "music", bg: "linear-gradient(160deg,#fb7185,#be123c)" }, blurb: "Generate voice and music", rating: 5, ratings: 1 }),
    A({ id: "terminal", name: "Terminal", tile: { icon: "terminal", bg: "linear-gradient(160deg,#2d333b,#0d1117)" }, blurb: "Run scripts in the worker's Linux VM", rating: 5, ratings: 2 }),

    // ── Featured AI apps ─────────────────────────────────────────────
    A({ id: "chatgpt", name: "ChatGPT", domain: "chatgpt.com", blurb: "Ask ChatGPT from inside a task", rating: 4.9, ratings: 12 }),
    A({ id: "gemini", name: "Gemini", domain: "gemini.google.com", blurb: "Google's assistant", rating: 4.8, ratings: 6 }),
    A({ id: "claude", name: "Claude", domain: "claude.ai", blurb: "Anthropic's assistant", rating: 5, ratings: 9 }),
    A({ id: "perplexity", name: "Perplexity", domain: "perplexity.ai", blurb: "Answer engine with sources", rating: 4.8, ratings: 4 }),

    // ── Google Workspace (local tiles: logo.dev returns the parent G) ─
    A({ id: "gmail", name: "Gmail", tile: { icon: "mail", bg: "#fff", fg: "#ea4335" }, blurb: "Google mail", rating: 4.9, ratings: 8 }),
    A({ id: "gsheets", name: "Google Sheets", tile: { icon: "sheet", bg: "#fff", fg: "#0f9d58" }, blurb: "Google spreadsheets", rating: 4.9, ratings: 7 }),
    A({ id: "gdocs", name: "Google Docs", tile: { icon: "doc", bg: "#fff", fg: "#4285f4" }, blurb: "Google documents", rating: 4.8, ratings: 5 }),
    A({ id: "gslides", name: "Google Slides", tile: { icon: "slides", bg: "#fff", fg: "#f4b400" }, blurb: "Google presentations", rating: 4.8, ratings: 3 }),
    A({ id: "gdrive", name: "Google Drive", tile: { icon: "drive", bg: "#fff", fg: "#1fa463" }, blurb: "Cloud storage", rating: 4.9, ratings: 6 }),
    A({ id: "gcal", name: "Google Calendar", tile: { icon: "calendar", bg: "#fff", fg: "#4285f4" }, blurb: "Events and scheduling", rating: 4.9, ratings: 5 }),
    A({ id: "gads", name: "Google Ads", tile: { icon: "megaphone", bg: "#fff", fg: "#fbbc04" }, blurb: "Campaigns and the Ads Transparency Center", rating: 4.7, ratings: 3 }),

    // ── Connect your tools (logo.dev) ────────────────────────────────
    A({ id: "notion", name: "Notion", domain: "notion.so", blurb: "Docs, wikis and databases", rating: 4.9, ratings: 11 }),
    A({ id: "slack", name: "Slack", domain: "slack.com", blurb: "Team chat", rating: 4.8, ratings: 10 }),
    A({ id: "linkedin", name: "LinkedIn", domain: "linkedin.com", blurb: "Professional network", rating: 4.7, ratings: 8 }),
    A({ id: "instagram", name: "Instagram", domain: "instagram.com", blurb: "Photos and comments", rating: 4.6, ratings: 6 }),
    A({ id: "x", name: "X", domain: "x.com", blurb: "Posts and replies", rating: 4.5, ratings: 6 }),
    A({ id: "hubspot", name: "HubSpot", domain: "hubspot.com", blurb: "CRM and marketing", rating: 4.8, ratings: 5 }),
    A({ id: "salesforce", name: "Salesforce", domain: "salesforce.com", blurb: "CRM", rating: 4.6, ratings: 4 }),
    A({ id: "github", name: "GitHub", domain: "github.com", blurb: "Code, issues and pull requests", rating: 4.9, ratings: 9 }),
    A({ id: "jira", name: "Jira", domain: "atlassian.com", blurb: "Issues and sprints", rating: 4.5, ratings: 4 }),
    A({ id: "shopify", name: "Shopify", domain: "shopify.com", blurb: "Orders, products and customers", rating: 4.8, ratings: 5 }),
    A({ id: "stripe", name: "Stripe", domain: "stripe.com", blurb: "Payments dashboard", rating: 4.9, ratings: 4 }),
    A({ id: "airtable", name: "Airtable", domain: "airtable.com", blurb: "Bases and views", rating: 4.7, ratings: 3 }),
    A({ id: "figma", name: "Figma", domain: "figma.com", blurb: "Design files", rating: 4.8, ratings: 4 }),
    A({ id: "zendesk", name: "Zendesk", domain: "zendesk.com", blurb: "Support tickets", rating: 4.6, ratings: 3 }),
    A({ id: "trello", name: "Trello", domain: "trello.com", blurb: "Boards and cards", rating: 4.6, ratings: 3 }),
    A({ id: "outlook", name: "Outlook", domain: "outlook.com", blurb: "Microsoft mail and calendar", rating: 4.5, ratings: 4 }),
  ].map((a) => [a.id, a]),
);

export const APP_SECTIONS: AppSection[] = [
  { id: "featured", title: "Featured apps", apps: ["chatgpt", "gemini", "claude", "perplexity"] },
  {
    id: "everfern",
    title: "EverFern apps",
    apps: ["files", "mail", "browser", "websearch", "sheets", "docs", "slides", "pdf", "sketch", "images", "audio", "terminal"],
  },
  { id: "google", title: "Google Workspace", apps: ["gmail", "gsheets", "gdocs", "gslides", "gdrive", "gcal", "gads"] },
  {
    id: "tools",
    title: "Connect your tools",
    apps: ["notion", "slack", "linkedin", "instagram", "x", "hubspot", "salesforce", "github", "jira", "shopify", "stripe", "airtable", "figma", "zendesk", "trello", "outlook"],
  },
];

/** Every worker starts with these. */
export const DEFAULT_APPS = ["files", "browser", "websearch"];
