import {
  GoalSchema,
  OrganizationSchema,
  type AutonomyLevel,
  type Goal,
  type GoalStatus,
  type Organization,
  type OrganizationStatus,
} from "@aop/protocol";

import { assertExpectedRevision, invariant } from "./errors.js";

export type OrganizationCreateInput = Omit<Organization, "revision">;
export type GoalCreateInput = Omit<Goal, "revision">;

const ORGANIZATION_TRANSITIONS: Readonly<Record<OrganizationStatus, readonly OrganizationStatus[]>> = {
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: [],
};

const GOAL_TRANSITIONS: Readonly<Record<GoalStatus, readonly GoalStatus[]>> = {
  planned: ["active", "cancelled"],
  active: ["blocked", "completed", "cancelled"],
  blocked: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

export function createOrganization(input: OrganizationCreateInput): Organization {
  return OrganizationSchema.parse({ ...input, revision: 0 });
}

export function transitionOrganizationStatus(
  current: Organization,
  next: OrganizationStatus,
  expectedRevision: number,
  updatedAt: string,
): Organization {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(
    ORGANIZATION_TRANSITIONS[current.status].includes(next),
    `Invalid organization status transition: ${current.status} -> ${next}`,
    { currentStatus: current.status, nextStatus: next },
  );

  return OrganizationSchema.parse({
    ...current,
    status: next,
    revision: current.revision + 1,
    updatedAt,
  });
}

export interface OrganizationProfilePatch {
  readonly name?: string;
  readonly mission?: string;
  readonly autonomyLevel?: AutonomyLevel;
}

export function updateOrganizationProfile(
  current: Organization,
  patch: OrganizationProfilePatch,
  expectedRevision: number,
  updatedAt: string,
): Organization {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(current.status !== "closed", "Closed organizations are immutable", {
    organizationId: current.id,
  });
  invariant(Object.keys(patch).length > 0, "Organization profile update must change at least one field");

  return OrganizationSchema.parse({
    ...current,
    ...patch,
    revision: current.revision + 1,
    updatedAt,
  });
}

export function createGoal(input: GoalCreateInput): Goal {
  return GoalSchema.parse({ ...input, revision: 0 });
}

export function transitionGoalStatus(
  current: Goal,
  next: GoalStatus,
  expectedRevision: number,
  updatedAt: string,
): Goal {
  assertExpectedRevision(current.revision, expectedRevision);
  invariant(GOAL_TRANSITIONS[current.status].includes(next), `Invalid goal status transition: ${current.status} -> ${next}`, {
    currentStatus: current.status,
    nextStatus: next,
  });

  const candidate: Goal = { ...current };
  candidate.status = next;
  candidate.revision = current.revision + 1;
  candidate.updatedAt = updatedAt;

  if (next === "completed") {
    candidate.completedAt = updatedAt;
  } else {
    delete candidate.completedAt;
  }

  return GoalSchema.parse(candidate);
}
