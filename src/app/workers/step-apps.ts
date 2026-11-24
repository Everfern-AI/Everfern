/** Which apps a plan step uses, and how the plan's ticks move. Kept out of page.tsx so it can be tested. */
import { APPS } from "@/lib/apps";

/** One "update_plan_step done" from the agent. When the agent planned its own list against the
 *  workflow's steps, its progress is mapped onto the workflow's steps in proportion. */
export function planStepDone<P extends { steps: string[]; done: number; agent?: { total: number; done: number } }>(p: P): P {
  if (!p.agent) return { ...p, done: Math.min(p.steps.length, p.done + 1) };
  const agentDone = Math.min(p.agent.total, p.agent.done + 1);
  const mapped = Math.floor((agentDone * p.steps.length) / p.agent.total);
  return { ...p, agent: { ...p.agent, done: agentDone }, done: Math.min(p.steps.length, Math.max(p.done, mapped)) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match. Very short words ("X") must also match in case, so "x" in "2 x 3" or
 *  "extract" never counts as the X app. */
function namesWord(step: string, word: string) {
  const w = word.trim();
  if (!w) return false;
  const short = w.replace(/\W/g, "").length <= 2;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, short ? "u" : "iu").test(step);
}

/** The worker's apps that a step names, by id or name, as whole words. */
export function appsInStep(step: string, apps: string[]) {
  return apps.filter((id) => {
    const app = APPS[id];
    if (!app) return false;
    const n = app.name;
    // A longer app name in the step ("Google Sheets") does not also count as the shorter one ("Sheets").
    const longer = apps.map((o) => APPS[o]?.name ?? "").filter((o) => o.length > n.length && o.toLowerCase().includes(n.toLowerCase()));
    const rest = longer.reduce((t, o) => t.replace(new RegExp(escapeRe(o), "gi"), " "), step);
    if (namesWord(rest, n)) return true;
    if (id.length > 2 && namesWord(rest, id)) return true;
    // "Google Sheets" is often written just "Sheets", unless the worker also has an app named "Sheets".
    const short = n.slice(7);
    const taken = apps.some((o) => o !== id && APPS[o]?.name.toLowerCase() === short.toLowerCase());
    if (/^google /i.test(n) && !taken && namesWord(step, short)) return true;
    return false;
  });
}

/** Apps a step will likely use when it does not name one: by what the step does. */
export const STEP_HINTS: Array<[RegExp, string[]]> = [
  [/\b(search|research|find|look ?up|browse|websites?|online|web|directories|compare|top-rated|reviews?)\b/i, ["websearch", "browser", "chrome"]],
  [/\b(spreadsheets?|sheets?|rows?|columns?|tables?)\b/i, ["sheets", "gsheets"]],
  [/\b(emails?|inbox|mail|reply|replies)\b/i, ["gmail", "mail", "outlook"]],
  [/\b(files?|folders?|save|download|compile|document|pdf)\b/i, ["files", "docs"]],
  [/\b(terminal|script|command|python|bash|shell)\b/i, ["terminal"]],
  [/\b(calendar|meeting|schedule)\b/i, ["gcal", "outlook"]],
];

export function stepApps(step: string, apps: string[], used: string[] = []) {
  const out = [...used.filter((id) => APPS[id])];
  const named = appsInStep(step, apps);
  for (const id of named) if (!out.includes(id)) out.push(id);
  if (!out.length) {
    for (const [re, ids] of STEP_HINTS) {
      if (!re.test(step)) continue;
      // Search and Files are built in, so a step can use them even when the worker does not list them.
      const pick = ids.find((id) => apps.includes(id)) ?? (ids[0] === "websearch" || ids[0] === "files" ? ids[0] : undefined);
      if (pick && APPS[pick] && !out.includes(pick)) out.push(pick);
    }
  }
  return out.slice(0, 3);
}
