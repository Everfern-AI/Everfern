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
    | "image" | "music" | "pen" | "calendar" | "drive" | "megaphone" | "terminal" | "cloud";
  /** CSS background for the rounded tile */
  bg: string;
  fg?: string;
};

export type AppReview = {
  id: string;
  author: string;
  rating: number;
  date: string;
  comment: string;
};

export type AppDef = {
  id: string;
  name: string;
  domain?: string;
  tile?: AppTile;
  /** simpleicons.org slug: brand mark on white, for sub-brands logo.dev collapses */
  icon?: string;
  /** With `icon`: draw the mark in white on this brand-colour tile instead of on white. */
  iconBg?: string;
  /** Page the worker's browser opens (usually the sign-in page) */
  url?: string;
  blurb: string;
  rating: number;
  ratings: number;
  category?: string;
  developer?: string;
  description?: string;
  features?: string[];
  reviews?: AppReview[];
};

export type AppSection = { id: string; title: string; apps: string[] };

const A = (a: AppDef) => a;

export const APPS: Record<string, AppDef> = Object.fromEntries(
  [
    // ── EverFern apps (run inside the worker's computer) ─────────────
    A({
      id: "files", name: "Files", tile: { icon: "folder", bg: "linear-gradient(160deg,#6fb7ff,#2f7cf6)" },
      blurb: "Browse and organise the worker's files", rating: 5, ratings: 28, category: "System", developer: "EverFern",
      description: "Files provides a complete virtual filesystem for your EverFern worker. Store downloaded PDFs, exported spreadsheets, generated images, and temporary task deliverables in isolated, secure storage.",
      features: ["Instant access to worker download directory", "Drag-and-drop file staging", "Secure sandboxed workspace isolation", "Automatic duplicate naming & archiving"],
    }),
    A({
      id: "mail", url: "https://mail.google.com", name: "Mail", tile: { icon: "mail", bg: "linear-gradient(160deg,#5ac8fa,#1e88e5)" },
      blurb: "Read, sort and send email", rating: 5, ratings: 19, category: "Communication", developer: "EverFern",
      description: "Mail enables automated email management. The worker can monitor inboxes for receipts, dispatch customer status updates, and archive routine supplier threads.",
      features: ["Inbox monitoring for financial receipts", "Drafting and sending automated updates", "Attachment downloading & routing", "Custom filter rules"],
    }),
    A({
      id: "chrome", url: "https://www.google.com", icon: "googlechrome", name: "Chrome",
      blurb: "Google Chrome, in its own tab on the worker's computer", rating: 5, ratings: 44, category: "Browser", developer: "Google LLC",
      description: "Google Chrome gives the worker full access to the open web with modern extensions and standard rendering.",
      features: ["Full extension ecosystem compatibility", "Multi-tab browser automation", "Isolated persistent cookies and sessions"],
    }),
    A({
      id: "browser", name: "Browser", tile: { icon: "globe", bg: "linear-gradient(160deg,#4fd1a5,#1f9d74)" },
      blurb: "A full web browser the worker can drive", rating: 5, ratings: 32, category: "Browser", developer: "EverFern",
      description: "The built-in EverFern browser is purpose-built for AI computer use, enabling robust navigation, form filling, and DOM interaction.",
      features: ["Visual AI cursor and coordinate navigation", "Smart anti-bot tolerance", "Deep tab management"],
    }),
    A({
      id: "websearch", name: "Web search", tile: { icon: "search", bg: "linear-gradient(160deg,#3b3f46,#16181b)" },
      blurb: "Search the web and read results", rating: 5, ratings: 21, category: "Research", developer: "EverFern",
      description: "Fast web search integration giving the worker access to live internet knowledge, citations, and product research.",
      features: ["Instant real-time search queries", "Structured snippet extraction", "Automatic source verification"],
    }),
    A({
      id: "sheets", name: "Sheets", tile: { icon: "sheet", bg: "linear-gradient(160deg,#43d17a,#169c4b)" },
      blurb: "Spreadsheets with formulas and charts", rating: 4.8, ratings: 52, category: "Productivity", developer: "EverFern",
      description: "The native EverFern Sheets app. The worker writes cells instantly with sheets_write/sheets_append, imports and exports CSV to Files, and the user watches a human-paced replay of the AI clicking and typing into each cell.",
      features: ["Fast cell/range writes with animated replay", "CSV import and export to Files", "Formulas: SUM, AVERAGE, MIN, MAX, COUNT", "Pixel-coordinate GUI automation"],
    }),
    A({
      id: "docs", url: "https://docs.google.com/document", icon: "googledocs", name: "Google Docs",
      blurb: "Google documents", rating: 4.8, ratings: 60, category: "Productivity", developer: "Google LLC",
      description: "Create and collaborate on online documents in real-time.",
      features: ["Smart canvas", "Document sharing", "Version history"],
    }),
    A({
      id: "slides", url: "https://docs.google.com/presentation", name: "Slides", tile: { icon: "slides", bg: "linear-gradient(160deg,#ffb547,#f08a1c)" },
      blurb: "Build presentations", rating: 5, ratings: 15, category: "Productivity", developer: "Google LLC",
      description: "Create and update presentation decks with automated graphs, slide generation, and brand consistency.",
      features: ["Slide duplication and text updates", "Chart and image insertion", "Deck export"],
    }),
    A({
      id: "pdf", url: "https://www.ilovepdf.com", name: "PDF", tile: { icon: "pdf", bg: "linear-gradient(160deg,#ff6b6b,#e03131)" },
      blurb: "Open, fill and annotate PDFs", rating: 4.9, ratings: 30, category: "Utility", developer: "EverFern",
      description: "Inspect, read text from, merge, and split PDF documents such as supplier invoices, tax filings, and legal agreements.",
      features: ["High-accuracy text and table OCR", "PDF splitting and merging", "Form filling and signing"],
    }),
    A({
      id: "sketch", url: "https://excalidraw.com", name: "Sketchbook", tile: { icon: "pen", bg: "linear-gradient(160deg,#c084fc,#7c3aed)" },
      blurb: "Quick diagrams and image edits", rating: 5, ratings: 12, category: "Design", developer: "EverFern",
      description: "Draw diagrams, flowcharts, architecture plans, and visual wireframes automatically.",
      features: ["Infinite canvas diagrams", "Hand-drawn aesthetics", "PNG/SVG exports"],
    }),
    A({
      id: "images", url: "https://www.canva.com", name: "Pixels", tile: { icon: "image", bg: "linear-gradient(160deg,#f472b6,#db2777)" },
      blurb: "Generate and edit images", rating: 5, ratings: 18, category: "Design", developer: "EverFern",
      description: "AI-powered image creation, banner resizing, background removal, and asset generation.",
      features: ["Generative image creation", "Aspect ratio formatting", "Asset library management"],
    }),
    A({
      id: "audio", url: "https://elevenlabs.io/app/sign-in", name: "Tunes", tile: { icon: "music", bg: "linear-gradient(160deg,#fb7185,#be123c)" },
      blurb: "Generate voice and music", rating: 5, ratings: 14, category: "Media", developer: "EverFern",
      description: "Synthesize lifelike voiceovers, transcribe podcast audio, and generate audio stems.",
      features: ["High-fidelity voice synthesis", "Audio transcription", "MP3/WAV export"],
    }),
    A({
      id: "terminal", name: "Terminal", tile: { icon: "terminal", bg: "linear-gradient(160deg,#2d333b,#0d1117)" },
      blurb: "Run scripts in the worker's Linux VM", rating: 5, ratings: 38, category: "Developer", developer: "EverFern",
      description: "A private Linux shell inside the worker's virtual machine. Execute bash scripts, run Python data pipelines, and manage git repositories.",
      features: ["Native bash & zsh execution", "Python, Node.js and curl pre-installed", "Full filesystem and package manager access"],
    }),

    // ── Featured AI apps ─────────────────────────────────────────────
    A({ id: "chatgpt", url: "https://chatgpt.com/auth/login", name: "ChatGPT", domain: "chatgpt.com", blurb: "Ask ChatGPT from inside a task", rating: 4.9, ratings: 124, category: "AI", developer: "OpenAI", description: "Query OpenAI's flagship conversational model for creative ideation, code debugging, and text synthesis.", features: ["GPT-4o reasoning", "Web-browsing assistance", "Code generation"] }),
    A({ id: "gemini", url: "https://gemini.google.com/app", icon: "googlegemini", name: "Gemini", domain: "gemini.google.com", blurb: "Google's assistant", rating: 4.8, ratings: 96, category: "AI", developer: "Google LLC", description: "Google's multimodal assistant with deep Google Workspace connectivity and ultra-fast inference.", features: ["Multimodal vision & audio", "Deep Google ecosystem integration", "Long-context reasoning"] }),
    A({ id: "claude", url: "https://claude.ai/login", icon: "claude", name: "Claude", domain: "claude.ai", blurb: "Anthropic's assistant", rating: 5, ratings: 110, category: "AI", developer: "Anthropic", description: "Anthropic's safety-first AI model designed for nuanced writing, deep research synthesis, and coding.", features: ["Extended context window", "Artifact generation", "Thoughtful analysis"] }),
    A({ id: "perplexity", url: "https://www.perplexity.ai", icon: "perplexity", name: "Perplexity", domain: "perplexity.ai", blurb: "Answer engine with sources", rating: 4.8, ratings: 62, category: "AI", developer: "Perplexity AI", description: "AI-powered search engine providing conversational answers backed by verified online citations.", features: ["Real-time academic & web citations", "Source verification", "Pro search deep dives"] }),

    // ── Google Workspace ─────────────────────────────────────────────
    A({
      id: "gmail", url: "https://mail.google.com", icon: "gmail", name: "Gmail", domain: "mail.google.com",
      blurb: "Google mail, inbox automation and invoice parsing", rating: 4.9, ratings: 148, category: "Communication", developer: "Google LLC",
      description: "Gmail is the industry standard for business and personal communication. EverFern workers filter threads, extract supplier invoices, parse notifications, and draft intelligent replies.",
      features: ["Automated receipt and billing extraction", "Inbox categorization and smart labeling", "Draft response composition", "Attachment routing to Google Drive"],
    }),
    A({ id: "gsheets", url: "https://docs.google.com/spreadsheets", icon: "googlesheets", name: "Google Sheets", blurb: "Google spreadsheets", rating: 4.9, ratings: 75, category: "Productivity", developer: "Google LLC", description: "Cloud spreadsheets for real-time team collaboration.", features: ["Formulas and macros", "Pivot tables", "Real-time sync"] }),
    A({ id: "gslides", url: "https://docs.google.com/presentation", icon: "googleslides", name: "Google Slides", blurb: "Google presentations", rating: 4.8, ratings: 41, category: "Productivity", developer: "Google LLC", description: "Create engaging presentations online.", features: ["Slide templates", "Presenter tools", "Cloud sync"] }),
    A({ id: "gdrive", url: "https://drive.google.com", icon: "googledrive", name: "Google Drive", blurb: "Cloud storage", rating: 4.9, ratings: 88, category: "Storage", developer: "Google LLC", description: "Store, share, and collaborate on files and folders from any device.", features: ["File backups", "Folder permissions", "Instant file search"] }),
    A({ id: "gcal", url: "https://calendar.google.com", icon: "googlecalendar", name: "Google Calendar", blurb: "Events and scheduling", rating: 4.9, ratings: 54, category: "Productivity", developer: "Google LLC", description: "Time management and scheduling calendar service.", features: ["Meeting scheduling", "Calendar invites", "Recurring reminders"] }),
    A({ id: "gads", url: "https://ads.google.com", icon: "googleads", name: "Google Ads", blurb: "Campaigns and the Ads Transparency Center", rating: 4.7, ratings: 36, category: "Marketing", developer: "Google LLC", description: "Online advertising platform to manage PPC campaigns and ad spend.", features: ["Campaign monitoring", "Spend exports", "Keyword analytics"] }),

    // ── Connect your tools ───────────────────────────────────────────
    A({
      id: "amazon", url: "https://www.amazon.com", name: "Amazon", domain: "amazon.com",
      blurb: "Orders, invoices and business purchases", rating: 4.8, ratings: 92, category: "Shopping & Invoices", developer: "Amazon.com, Inc.",
      description: "Amazon integration empowers your EverFern worker to access your order history, retrieve PDF invoices and credit notes, verify delivered shipments, and match purchases against accounting card charges.",
      features: [
        "Download latest single invoice or order receipt without previewing",
        "Retain exact official vendor file names",
        "Track package delivery and shipment status",
        "Automatic cross-reference with Moss, SAP, and bank statements",
      ],
    }),
    A({
      id: "canva", url: "https://www.canva.com/login", name: "Canva", domain: "canva.com", icon: "canva", iconBg: "#00c4cc",
      blurb: "Design presentations, social posts, and retrieve billing receipts", rating: 4.9, ratings: 114, category: "Design & Creative", developer: "Canva Pty Ltd",
      description: "Canva is the leading visual communications platform. EverFern workers download subscription invoices, export marketing templates, clone brand kits, and automate graphic generation workflows.",
      features: [
        "Single-click subscription invoice and billing retrieval",
        "Batch export of presentations and marketing cards",
        "Brand kit consistency enforcement",
        "Automated asset synchronization with Files",
      ],
    }),
    A({
      id: "moss", url: "https://app.getmoss.com/login", name: "Moss", domain: "getmoss.com",
      tile: { icon: "doc", bg: "linear-gradient(160deg,#20262e,#0f1318)" },
      blurb: "Corporate cards, invoice matching, and spend management", rating: 4.8, ratings: 68, category: "Finance & Accounting", developer: "Moss Technologies GmbH",
      description: "Moss is Europe's premier holistic spend management platform. EverFern workers match downloaded supplier invoices directly to corresponding corporate card charges, verifying transaction amounts and VAT automatically.",
      features: [
        "Attach downloaded invoices to exact credit card charges",
        "Automated filename and amount verification",
        "Multi-card transaction matching across Amazon, Canva, and LinkedIn",
        "Eliminates missing receipt reminders for employees",
      ],
    }),
    A({
      id: "sap", url: "https://my.sap.com", name: "SAP", domain: "sap.com", icon: "sap", iconBg: "#008fd3",
      blurb: "Enterprise ERP, accounting, and supply chain management", rating: 4.8, ratings: 84, category: "Enterprise ERP", developer: "SAP SE",
      description: "SAP is the global market leader in enterprise resource planning. EverFern workers interface with SAP to automate financial ledger postings, sales orders, purchase orders, vendor invoices, and inventory status checks across enterprise instances.",
      features: [
        "Automated journal entries and ledger reconciliation",
        "Purchase order verification and 3-way matching",
        "Customer sales order creation and updates",
        "Enterprise inventory audit and status reporting",
      ],
    }),
    A({
      id: "youtube", url: "https://www.youtube.com", name: "YouTube", domain: "youtube.com", icon: "youtube", iconBg: "#ff0000",
      blurb: "Video streaming, content research, transcripts, and analytics", rating: 4.9, ratings: 132, category: "Media & Video", developer: "Google LLC",
      description: "YouTube is the world's largest video community. EverFern workers monitor competitor channels, extract full transcripts for documentation, inspect video engagement analytics, and schedule uploads through YouTube Studio.",
      features: [
        "Extract video transcripts and timestamps automatically",
        "Channel analytics and performance monitoring",
        "Video metadata, description, and tag updates",
        "Competitor research and industry trend alerts",
      ],
    }),
    A({
      id: "spotify", url: "https://open.spotify.com", name: "Spotify", domain: "spotify.com", icon: "spotify", iconBg: "#1ed760",
      blurb: "Audio streaming, podcast analytics, and music playback", rating: 4.8, ratings: 98, category: "Audio & Music", developer: "Spotify AB",
      description: "Spotify offers digital music and podcast streaming. EverFern workers can monitor podcast release schedules, track artist and episode metrics, curate playlist metadata, and provide ambient playback controls.",
      features: [
        "Podcast episode monitoring and show notes extraction",
        "Playlist metadata curation and track research",
        "Artist listener analytics tracking",
        "Ambient media control and playback routines",
      ],
    }),
    A({
      id: "linkedin", url: "https://www.linkedin.com/login", name: "LinkedIn", domain: "linkedin.com", icon: "linkedin", iconBg: "#0a66c2",
      blurb: "Professional network, ad billing receipts, and lead research", rating: 4.8, ratings: 95, category: "Social & Professional", developer: "LinkedIn Corporation",
      description: "LinkedIn connects the world's professionals. EverFern workers retrieve monthly advertising invoices, track company page metrics, source prospective candidates, and manage professional lead workflows.",
      features: [
        "Download latest ad invoices and billing statements",
        "Company page post metrics and follower growth tracking",
        "Automated profile research and talent sourcing",
        "Lead list synchronization",
      ],
    }),
    A({
      id: "whatsapp", url: "https://web.whatsapp.com", name: "WhatsApp", domain: "whatsapp.com", icon: "whatsapp", iconBg: "#25d366",
      blurb: "Client messaging and team alerts via WhatsApp Web", rating: 4.8, ratings: 82, category: "Communication", developer: "Meta Platforms, Inc.",
      description: "WhatsApp Web enables automated notifications, customer support triage, and dispatching urgent order confirmations directly to customer chat threads.",
      features: ["Client notification dispatching", "Support inquiry triage", "Order confirmation alerts"],
    }),
    A({
      id: "discord", url: "https://discord.com/app", name: "Discord", domain: "discord.com", icon: "discord", iconBg: "#5865f2",
      blurb: "Community servers, voice channels, and bot notifications", rating: 4.8, ratings: 76, category: "Community", developer: "Discord Inc.",
      description: "Discord connects communities and teams. EverFern workers post build alerts, moderate announcement channels, and monitor user feedback.",
      features: ["Channel announcement broadcasts", "Community sentiment monitoring", "Server moderation assistance"],
    }),
    A({
      id: "zoom", url: "https://zoom.us/signin", name: "Zoom", domain: "zoom.us", icon: "zoom", iconBg: "#2d8cff",
      blurb: "Video meetings, recording downloads, and transcripts", rating: 4.7, ratings: 64, category: "Meetings", developer: "Zoom Video Communications",
      description: "Zoom video meetings integration. Download cloud recordings, summarize meeting transcripts, and dispatch follow-ups.",
      features: ["Cloud recording retrieval", "Transcript extraction and summarization", "Meeting attendee follow-up dispatching"],
    }),
    A({ id: "notion", url: "https://www.notion.so/login", name: "Notion", domain: "notion.so", icon: "notion", blurb: "Docs, wikis and databases", rating: 4.9, ratings: 112, category: "Productivity", developer: "Notion Labs, Inc.", description: "The all-in-one workspace for notes, tasks, wikis, and databases.", features: ["Database row creation", "Wiki page documentation", "Sync across boards"] }),
    A({ id: "slack", url: "https://app.slack.com/signin", name: "Slack", domain: "slack.com", icon: "slack", blurb: "Team chat and automated status broadcasts", rating: 4.8, ratings: 104, category: "Communication", developer: "Salesforce, Inc.", description: "Real-time team messaging platform for business collaboration.", features: ["Channel messaging", "Direct notifications", "Workflow notifications"] }),
    A({ id: "github", url: "https://github.com/login", name: "GitHub", domain: "github.com", icon: "github", blurb: "Code, issues and pull requests", rating: 4.9, ratings: 98, category: "Developer", developer: "GitHub, Inc.", description: "Software development and version control using Git.", features: ["Issue triage", "PR description writing", "Release notes generation"] }),
    A({ id: "shopify", url: "https://accounts.shopify.com/lookup", name: "Shopify", domain: "shopify.com", icon: "shopify", iconBg: "#7ab55c", blurb: "Orders, products and customers", rating: 4.8, ratings: 72, category: "E-Commerce", developer: "Shopify Inc.", description: "Complete e-commerce platform to run, market, and grow your online business.", features: ["Order status tracking", "Inventory audits", "Customer profile exports"] }),
    A({ id: "stripe", url: "https://dashboard.stripe.com/login", icon: "stripe", iconBg: "#635bff", name: "Stripe", domain: "stripe.com", blurb: "Payments dashboard and financial reports", rating: 4.9, ratings: 88, category: "Finance", developer: "Stripe, Inc.", description: "Financial infrastructure for the internet: payments, payouts, and revenue metrics.", features: ["Monthly financial statement export", "Dispute notifications", "Balance reporting"] }),
    A({ id: "figma", url: "https://www.figma.com/login", name: "Figma", domain: "figma.com", icon: "figma", blurb: "Design files and design systems", rating: 4.8, ratings: 79, category: "Design", developer: "Figma, Inc.", description: "Collaborative interface design tool for modern product teams.", features: ["File version inspections", "Asset exports", "Component specs"] }),
    A({ id: "hubspot", url: "https://app.hubspot.com/login", name: "HubSpot", domain: "hubspot.com", icon: "hubspot", iconBg: "#ff7a59", blurb: "CRM and marketing automation", rating: 4.8, ratings: 64, category: "CRM", developer: "HubSpot, Inc.", description: "Customer relationship management, sales, and inbound marketing software.", features: ["Deal updates", "Contact enrichment", "Pipeline exports"] }),
    A({ id: "salesforce", url: "https://login.salesforce.com", name: "Salesforce", tile: { icon: "cloud", bg: "linear-gradient(160deg,#3fc3f5,#0b8fd8)" }, blurb: "CRM and enterprise sales pipelines", rating: 4.6, ratings: 58, category: "CRM", developer: "Salesforce, Inc.", description: "World's #1 customer relationship management platform.", features: ["Account management", "Opportunity updates", "Report exports"] }),
    A({ id: "jira", url: "https://id.atlassian.com/login", icon: "jira", iconBg: "#0052cc", name: "Jira", domain: "atlassian.com", blurb: "Issues, sprints, and project tracking", rating: 4.5, ratings: 51, category: "Project Management", developer: "Atlassian", description: "Issue and project tracker for agile development teams.", features: ["Sprint updates", "Backlog item triage", "Status transitions"] }),
    A({ id: "airtable", url: "https://airtable.com/login", name: "Airtable", domain: "airtable.com", icon: "airtable", iconBg: "#fcb400", blurb: "Connected apps and relational databases", rating: 4.7, ratings: 44, category: "Productivity", developer: "Airtable", description: "Cloud collaboration service with relational database power.", features: ["Record creation", "View filters", "Automated sync"] }),
    A({ id: "zendesk", url: "https://www.zendesk.com/login", name: "Zendesk", domain: "zendesk.com", icon: "zendesk", iconBg: "#03363d", blurb: "Customer service and support tickets", rating: 4.6, ratings: 40, category: "Support", developer: "Zendesk, Inc.", description: "Customer service software and support ticket management.", features: ["Ticket categorization", "Macro execution", "Resolution time tracking"] }),
    A({ id: "trello", url: "https://trello.com/login", name: "Trello", domain: "trello.com", icon: "trello", iconBg: "#0079bf", blurb: "Kanban boards and workflow cards", rating: 4.6, ratings: 46, category: "Productivity", developer: "Atlassian", description: "Visual collaboration tool for organizing work into boards and cards.", features: ["Card movements", "Checklist tracking", "Due date alerts"] }),
    A({ id: "instagram", url: "https://www.instagram.com/accounts/login", name: "Instagram", domain: "instagram.com", icon: "instagram", iconBg: "#e4405f", blurb: "Social media and brand engagement", rating: 4.6, ratings: 67, category: "Social Media", developer: "Meta Platforms, Inc.", description: "Photo and video sharing social networking service.", features: ["Post scheduling", "Comment monitoring", "Direct message triage"] }),
    A({ id: "x", url: "https://x.com/login", icon: "x", iconBg: "#000000", name: "X", domain: "x.com", blurb: "Posts, replies and trend monitoring", rating: 4.5, ratings: 71, category: "Social Media", developer: "X Corp.", description: "Real-time updates, news, and conversation platform.", features: ["Post publishing", "Mention monitoring", "List curation"] }),
    A({ id: "outlook", url: "https://outlook.live.com/mail", name: "Outlook", tile: { icon: "mail", bg: "linear-gradient(160deg,#28a8ea,#0a64d6)" }, blurb: "Microsoft mail and calendar", rating: 4.5, ratings: 53, category: "Communication", developer: "Microsoft Corporation", description: "Email client, calendar, and task manager from Microsoft.", features: ["Email sorting", "Calendar invites", "Rules automation"] }),
  ].map((a) => [a.id, a]),
);

export const APP_SECTIONS: AppSection[] = [
  { id: "featured", title: "Featured apps", apps: ["chatgpt", "gemini", "canva", "amazon", "moss", "sap", "youtube", "spotify", "claude", "perplexity"] },
  {
    id: "everfern",
    title: "EverFern apps",
    apps: ["files", "mail", "chrome", "browser", "websearch", "sheets", "slides", "pdf", "sketch", "images", "audio", "terminal"],
  },
  { id: "google", title: "Google Workspace", apps: ["gmail", "gsheets", "docs", "gslides", "gdrive", "gcal", "gads"] },
  {
    id: "tools",
    title: "Connect your tools",
    apps: [
      "amazon", "canva", "moss", "sap", "youtube", "spotify", "gmail", "linkedin", "whatsapp", "discord", "zoom",
      "notion", "slack", "github", "shopify", "stripe", "figma", "hubspot", "salesforce", "jira", "airtable", "zendesk", "trello", "instagram", "x", "outlook"
    ],
  },
];

/** Every worker starts with these. */
/**
 * New workers get the native EverFern apps. Google Sheets is installed too,
 * but it is opt-in: the worker only opens it when the user explicitly asks.
 */
export const DEFAULT_APPS = ["files", "sheets", "browser", "websearch", "gsheets"];
