import { describe, expect, it } from "vitest";

import { isExcludedLearner } from "./learner-exclusions";

describe("learner exclusions", () => {
  it.each([
    "Joseph Bailey",
    "Wemimo Buwanhot",
    "Jackson Cyprian",
    "Freya Johnson",
    "Colleen Stewart",
    "Celine Ababio",
    "Joanna Furnival",
    "Amber Deacon",
  ])("excludes %s by name", (name) => {
    expect(isExcludedLearner(undefined, name)).toBe(true);
  });

  it("excludes known ids even when the name is absent", () => {
    expect(isExcludedLearner(9115, undefined)).toBe(true);
    expect(isExcludedLearner("6450", undefined)).toBe(true);
  });

  it("normalizes case and whitespace", () => {
    expect(isExcludedLearner(undefined, "  CELINE   Ababio ")).toBe(true);
  });

  it("keeps other learners", () => {
    expect(isExcludedLearner(12345, "Included Learner")).toBe(false);
  });
});
