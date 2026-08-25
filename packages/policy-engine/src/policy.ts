import type {
  OrganizationId,
  Permission,
  PermissionEffect,
  Principal,
  ResourceRef,
  Role,
} from "@aop/protocol";

export type PolicyEffect = PermissionEffect;
export type PolicySource = "permission" | "role" | "default";

export interface PolicyEvaluationInput {
  readonly organizationId: OrganizationId;
  readonly principal: Principal;
  readonly capability: string;
  readonly resource?: ResourceRef;
  readonly permissions: readonly Permission[];
  readonly resolvedRoles: readonly Role[];
  readonly now: string;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export interface PolicyDecision {
  readonly effect: PolicyEffect;
  readonly source: PolicySource;
  readonly reason: string;
  readonly permissionId?: string;
  readonly roleId?: string;
}

interface Candidate extends PolicyDecision {
  readonly effectRank: number;
  readonly sourceRank: number;
}

const EFFECT_RANK: Readonly<Record<PolicyEffect, number>> = {
  deny: 3,
  require_approval: 2,
  allow: 1,
};

function samePrincipal(left: Principal, right: Principal): boolean {
  return left.type === right.type && left.id === right.id;
}

function sameResource(left: ResourceRef, right: ResourceRef): boolean {
  return left.type === right.type && left.id === right.id;
}

function permissionConditionsMatch(
  permission: Permission,
  context: Readonly<Record<string, string | number | boolean>>,
): boolean {
  return Object.entries(permission.conditions).every(([key, expected]) => context[key] === expected);
}

function permissionMatches(input: PolicyEvaluationInput, permission: Permission): boolean {
  if (permission.organizationId !== input.organizationId) return false;
  if (!samePrincipal(permission.principal, input.principal)) return false;
  if (permission.capability !== input.capability) return false;
  if (permission.expiresAt !== undefined && Date.parse(permission.expiresAt) <= Date.parse(input.now)) return false;
  if (permission.resource !== undefined) {
    if (input.resource === undefined || !sameResource(permission.resource, input.resource)) return false;
  }
  return permissionConditionsMatch(permission, input.context);
}

function permissionCandidates(input: PolicyEvaluationInput): readonly Candidate[] {
  return input.permissions.filter((permission) => permissionMatches(input, permission)).map((permission) => ({
    effect: permission.effect,
    source: "permission" as const,
    reason: `Matched explicit permission ${permission.id}`,
    permissionId: permission.id,
    effectRank: EFFECT_RANK[permission.effect],
    sourceRank: 2,
  }));
}

function roleCandidates(input: PolicyEvaluationInput): readonly Candidate[] {
  if (input.principal.type !== "agent") return [];

  const candidates: Candidate[] = [];
  for (const role of input.resolvedRoles) {
    if (role.organizationId !== input.organizationId) continue;

    let effect: PolicyEffect | undefined;
    if (role.authority.deniedCapabilities.includes(input.capability)) effect = "deny";
    else if (role.authority.approvalRequiredCapabilities.includes(input.capability)) effect = "require_approval";
    else if (role.authority.allowedCapabilities.includes(input.capability)) effect = "allow";

    if (effect !== undefined) {
      candidates.push({
        effect,
        source: "role",
        reason: `Matched authoritative role ${role.id}`,
        roleId: role.id,
        effectRank: EFFECT_RANK[effect],
        sourceRank: 1,
      });
    }
  }

  return candidates;
}

function publicDecision(candidate: Candidate): PolicyDecision {
  if (candidate.permissionId !== undefined) {
    return {
      effect: candidate.effect,
      source: candidate.source,
      reason: candidate.reason,
      permissionId: candidate.permissionId,
    };
  }
  if (candidate.roleId !== undefined) {
    return {
      effect: candidate.effect,
      source: candidate.source,
      reason: candidate.reason,
      roleId: candidate.roleId,
    };
  }
  return { effect: candidate.effect, source: candidate.source, reason: candidate.reason };
}

export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  const candidates = [...permissionCandidates(input), ...roleCandidates(input)].sort(
    (left, right) => right.effectRank - left.effectRank || right.sourceRank - left.sourceRank,
  );

  const winner = candidates[0];
  if (winner === undefined) {
    return {
      effect: "deny",
      source: "default",
      reason: "No authoritative policy grants this capability",
    };
  }

  return publicDecision(winner);
}
