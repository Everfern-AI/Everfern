// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
    formatMonthLabel,
    toMonthlySpendBars,
    computeUsageHealth,
} from "../AnalyticsPage";

const monthly = (month: string, cost: number, requests = 0, tokens = 0) => ({ month, tokens, cost, requests });
const day = (date: string, requests = 0, tokens = 0, cost = 0) => ({ date, tokens, cost, requests });
const model = (model: string, provider: string) => ({ model, provider, requests: 1, tokens: 10, cost: 0.1 });
const provider = (provider: string) => ({ provider, requests: 1, tokens: 10, cost: 0.1 });

describe("formatMonthLabel", () => {
    it("formats ISO year-month keys as short month labels", () => {
        expect(formatMonthLabel("2026-09")).toBe("Sep '26");
        expect(formatMonthLabel("2024-01")).toBe("Jan '24");
        expect(formatMonthLabel("2023-12")).toBe("Dec '23");
    });

    it("passes through non-ISO strings and handles empty input", () => {
        expect(formatMonthLabel("n/a")).toBe("n/a");
        expect(formatMonthLabel("")).toBe("");
        expect(formatMonthLabel("2026-13")).toBe("2026-13");
        expect(formatMonthLabel("2026-00")).toBe("2026-00");
    });
});

describe("toMonthlySpendBars", () => {
    it("maps monthlyUsage aggregates to sorted spend bars with month labels", () => {
        const bars = toMonthlySpendBars([
            monthly("2026-08", 1.5, 10, 1000),
            monthly("2026-09", 2.25, 20, 2000),
            monthly("2026-07", 0.75, 5, 500),
        ]);
        expect(bars).toEqual([
            { label: "Jul '26", cost: 0.75 },
            { label: "Aug '26", cost: 1.5 },
            { label: "Sep '26", cost: 2.25 },
        ]);
    });

    it("does not mutate the input array (returns a sorted copy)", () => {
        const input = [monthly("2026-09", 2), monthly("2026-08", 1)];
        toMonthlySpendBars(input);
        expect(input[0].month).toBe("2026-09");
    });

    it("drops entries with empty or missing month keys and tolerates null/undefined input", () => {
        expect(toMonthlySpendBars([monthly("", 5), monthly("2026-09", 1)])).toEqual([
            { label: "Sep '26", cost: 1 },
        ]);
        expect(toMonthlySpendBars(null)).toEqual([]);
        expect(toMonthlySpendBars(undefined)).toEqual([]);
    });

    it("normalizes missing cost values to 0", () => {
        const bars = toMonthlySpendBars([{ month: "2026-01", tokens: 0, requests: 0, cost: undefined as unknown as number }]);
        expect(bars).toEqual([{ label: "Jan '26", cost: 0 }]);
    });
});

describe("computeUsageHealth", () => {
    it("counts only days with recorded activity in the last 30d window", () => {
        const summary: any = {
            dailyUsage: [
                day("2026-08-30", 5, 100, 0.5),
                day("2026-08-31", 0, 0, 0), // recorded row, zero usage — not active
                day("2026-09-01", 2, 40, 0.2),
            ],
            totalRequests: 7,
            topProviders: [provider("openai"), provider("anthropic")],
            topModels: [model("gpt-4o", "openai")],
        };
        expect(computeUsageHealth(summary)).toEqual({
            daysActive30d: 2,
            activeProviders: 2,
            activeModels: 1,
            hasUsage: true,
        });
    });

    it("returns zeroed state for empty or missing summaries", () => {
        const zeroed = { daysActive30d: 0, activeProviders: 0, activeModels: 0, hasUsage: false };
        expect(computeUsageHealth(null)).toEqual(zeroed);
        expect(computeUsageHealth(undefined)).toEqual(zeroed);
        expect(computeUsageHealth({} as any)).toEqual(zeroed);
        expect(computeUsageHealth({ dailyUsage: [] } as any)).toEqual(zeroed);
    });

    it("treats a day with only cost (no requests/tokens) as active", () => {
        const summary: any = { dailyUsage: [day("2026-08-15", 0, 0, 0.02)], totalRequests: 0 };
        expect(computeUsageHealth(summary).daysActive30d).toBe(1);
        expect(computeUsageHealth(summary).hasUsage).toBe(true);
    });

    it("marks hasUsage true when only the 30d window recorded requests", () => {
        const summary: any = { dailyUsage: [day("2026-08-15", 3, 0, 0)], totalRequests: 0 };
        expect(computeUsageHealth(summary).hasUsage).toBe(true);
    });
});
