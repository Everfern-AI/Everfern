import { describe, expect, it } from "vitest";
import { appsInStep, planStepDone, stepApps } from "../step-apps";

describe("step app chips", () => {
  const apps = ["browser", "x", "gmail", "sheets", "amazon"];

  it("does not read 'x' inside other words as the X app", () => {
    expect(appsInStep("In Browser, extract the prices and execute the search on Google Flights", apps)).toEqual(["browser"]);
    expect(stepApps("Search one-way flights on Google Flights: HYD to RTM, 1 x adult", apps)).not.toContain("x");
  });

  it("still finds an app named as a word", () => {
    expect(appsInStep("Post the summary on X", apps)).toEqual(["x"]);
    expect(appsInStep("Find invoice emails in Gmail", apps)).toEqual(["gmail"]);
    expect(appsInStep("Search Amazon (.de) for the cheapest kettle", apps)).toEqual(["amazon"]);
  });

  it("gives a bare 'Sheets' to the Sheets app, not also Google Sheets", () => {
    expect(appsInStep("Add one row per invoice in Sheets", ["sheets", "gsheets"])).toEqual(["sheets"]);
    expect(appsInStep("Add one row per invoice in Sheets", ["gsheets"])).toEqual(["gsheets"]);
    expect(appsInStep("Add the rows in Google Sheets", ["sheets", "gsheets"])).toEqual(["gsheets"]);
  });

  it("puts apps the step really used first", () => {
    expect(stepApps("Sort the results by price", apps, ["browser"])).toEqual(["browser"]);
  });
});

describe("plan ticks", () => {
  const wf = { steps: ["a", "b", "c", "d"], done: 0 };

  it("moves one step at a time without an agent plan", () => {
    expect(planStepDone(wf).done).toBe(1);
  });

  it("maps the agent's own list onto the workflow's steps", () => {
    let p = { ...wf, agent: { total: 3, done: 0 } };
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) { p = planStepDone(p); seen.push(p.done); }
    expect(seen).toEqual([1, 2, 4]);
    expect(p.steps).toEqual(wf.steps);
  });

  it("never goes past the last step or backwards", () => {
    let p = { ...wf, done: 2, agent: { total: 8, done: 0 } };
    p = planStepDone(p);
    expect(p.done).toBe(2);
    for (let i = 0; i < 20; i++) p = planStepDone(p);
    expect(p.done).toBe(4);
  });
});
