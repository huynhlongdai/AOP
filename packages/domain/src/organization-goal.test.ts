import { describe, expect, it } from "vitest";

import type { Goal, Organization } from "@aop/protocol";

import { DomainError } from "./errors.js";
import {
  transitionGoalStatus,
  transitionOrganizationStatus,
  updateOrganizationProfile,
} from "./organization-goal.js";

const ULID = "00000000000000000000000000";
const t0 = "2026-08-25T12:00:00+07:00";
const t1 = "2026-08-25T12:05:00+07:00";

const organization: Organization = {
  id: `org_${ULID}`,
  name: "AOP Labs",
  type: "company",
  status: "active",
  owner: { type: "human", id: `usr_${ULID}` },
  autonomyLevel: "assistant_managed",
  revision: 3,
  createdAt: t0,
  updatedAt: t0,
};

const goal: Goal = {
  id: `gol_${ULID}`,
  organizationId: `org_${ULID}`,
  title: "Launch MVP",
  objective: "Release a verified MVP.",
  owner: { type: "agent", id: `agt_${ULID}` },
  successCriteria: ["Verified MVP is deployed"],
  priority: "critical",
  status: "active",
  revision: 4,
  createdAt: t0,
  updatedAt: t0,
};

describe("Organization / Goal domain services", () => {
  it("rejects stale optimistic revision", () => {
    expect(() => transitionOrganizationStatus(organization, "paused", 2, t1)).toThrow(DomainError);
  });

  it("increments revision on a valid organization transition", () => {
    const paused = transitionOrganizationStatus(organization, "paused", 3, t1);
    expect(paused.status).toBe("paused");
    expect(paused.revision).toBe(4);
  });

  it("treats closed organization as terminal", () => {
    const closed = transitionOrganizationStatus(organization, "closed", 3, t1);
    expect(() => updateOrganizationProfile(closed, { name: "Renamed" }, 4, t1)).toThrow(DomainError);
  });

  it("sets completion time only through completed transition", () => {
    const completed = transitionGoalStatus(goal, "completed", 4, t1);
    expect(completed.completedAt).toBe(t1);
    expect(() => transitionGoalStatus(completed, "active", 5, t1)).toThrow(DomainError);
  });
});
