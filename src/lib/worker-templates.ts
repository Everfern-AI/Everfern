/**
 * Quick-start templates for a new worker. Each one pre-fills the job prompt and
 * installs the apps it needs. Written for EverFern; app ids refer to src/lib/apps.ts.
 */

export type WorkerTemplate = {
  id: string;
  title: string;
  description: string;
  apps: string[];
  /** Numbered steps shown in the prompt card; the worker turns these into a workflow */
  prompt: string;
  featured?: boolean;
};

export const WORKER_TEMPLATES: WorkerTemplate[] = [
  {
    id: "social-replies",
    title: "Social comment replies",
    description: "Reads new comments on your latest LinkedIn, Instagram and X posts and drafts replies in your voice for you to approve.",
    apps: ["linkedin", "instagram", "x"],
    featured: true,
    prompt: [
      "1. Open LinkedIn, Instagram and X and go to my latest posts.",
      "2. Collect every comment from the last 24 hours that has no reply yet.",
      "3. Draft a short, friendly reply to each one in my tone. Skip spam.",
      "4. Show me the drafts and post the ones I approve.",
    ].join("\n"),
  },
  {
    id: "regulatory-digest",
    title: "Regulatory update email",
    description: "Checks regulator sites and news for changes that affect your industry and emails you a short digest every morning.",
    apps: ["mail", "websearch"],
    featured: true,
    prompt: [
      "1. Search the web for new regulations, guidance or enforcement news in my industry from the last day.",
      "2. Open each source and note what changed, who it affects and any deadline.",
      "3. Write a short digest with links, most important first.",
      "4. Email the digest to me with the subject \"Regulatory update\".",
    ].join("\n"),
  },
  {
    id: "ad-competitors",
    title: "Ad competitor tracking",
    description: "Looks up competitors in the Google Ads Transparency Center, logs their active ads in a sheet and saves screenshots to Files.",
    apps: ["gsheets", "gads", "files"],
    featured: true,
    prompt: [
      "1. Open the Google Ads Transparency Center.",
      "2. For each competitor in my list, find their ads from the last 7 days.",
      "3. Add each ad to the \"Competitor ads\" sheet: advertiser, format, headline, first seen.",
      "4. Save a screenshot of each new ad to Files › Competitor ads.",
    ].join("\n"),
  },
  {
    id: "inbox-triage",
    title: "Inbox triage",
    description: "Sorts your inbox every hour, labels what matters, drafts replies to routine mail and flags anything urgent.",
    apps: ["gmail", "gcal"],
    prompt: [
      "1. Open Gmail and read unread messages from the last hour.",
      "2. Label each one: Action, Waiting, FYI or Newsletter.",
      "3. Draft replies to routine requests and leave them in Drafts.",
      "4. Send me a summary of anything urgent.",
    ].join("\n"),
  },
  {
    id: "crm-hygiene",
    title: "CRM clean-up",
    description: "Finds duplicate and stale contacts in HubSpot, fills missing company details from the web and logs every change.",
    apps: ["hubspot", "websearch", "sheets"],
    prompt: [
      "1. Open HubSpot and list contacts created or edited this week.",
      "2. Merge obvious duplicates and fill missing company, role and website from the web.",
      "3. Log every change in a sheet so I can review it.",
    ].join("\n"),
  },
  {
    id: "invoice-filing",
    title: "Invoice filing",
    description: "Pulls invoice PDFs from your mail, renames and files them by month, and adds each one to a bookkeeping sheet.",
    apps: ["mail", "pdf", "files", "sheets"],
    prompt: [
      "1. Find new emails with invoice PDFs attached.",
      "2. Save each PDF to Files › Invoices › <month>, named <vendor>-<date>-<amount>.",
      "3. Add vendor, date, amount and due date to the bookkeeping sheet.",
    ].join("\n"),
  },
  {
    id: "notion-standup",
    title: "Stand-up notes",
    description: "Collects yesterday's activity from GitHub and Slack and writes a stand-up page in Notion before the team meets.",
    apps: ["github", "slack", "notion"],
    prompt: [
      "1. Collect yesterday's merged pull requests and open issues from GitHub.",
      "2. Read the team's Slack channel for blockers.",
      "3. Write today's stand-up page in Notion: done, doing, blocked.",
    ].join("\n"),
  },
  {
    id: "order-followup",
    title: "Order follow-ups",
    description: "Checks Shopify for delayed orders and sends each customer a short, personal status update.",
    apps: ["shopify", "mail"],
    prompt: [
      "1. Open Shopify and find orders unfulfilled for more than 3 days.",
      "2. Check the shipping status of each one.",
      "3. Email each customer a short update and log it on the order.",
    ].join("\n"),
  },
];

export const FEATURED_TEMPLATES = WORKER_TEMPLATES.filter((t) => t.featured);
