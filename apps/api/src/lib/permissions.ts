import type { Role } from "@nepal-hand-pay/shared-types";

export const permissions = [
  "platform.read",
  "user.read",
  "user.freeze",
  "merchant.read",
  "merchant.approve",
  "kyc.read",
  "kyc.review",
  "kyb.read",
  "kyb.review",
  "payment.create",
  "transaction.read",
  "refund.create",
  "audit.read",
  "security.read",
  "fraud.read",
  "configuration.write",
  "ledger.read",
  "wallet.adjust",
] as const;

export type Permission = (typeof permissions)[number];

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  CUSTOMER: new Set(["transaction.read", "security.read"]),
  MERCHANT: new Set([
    "payment.create",
    "transaction.read",
    "refund.create",
    "security.read",
  ]),
  ADMIN: new Set(permissions),
  AUDITOR: new Set([
    "platform.read",
    "user.read",
    "merchant.read",
    "kyc.read",
    "kyb.read",
    "transaction.read",
    "audit.read",
    "security.read",
    "fraud.read",
    "ledger.read",
  ]),
};

export function hasPermission(role: Role, permission: Permission) {
  return rolePermissions[role].has(permission);
}

export function permissionsFor(role: Role) {
  return [...rolePermissions[role]];
}
