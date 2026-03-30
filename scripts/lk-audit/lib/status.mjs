/** @typedef {'present_and_verified' | 'present_but_unverified' | 'missing' | 'drifted' | 'broken' | 'UNVERIFIED'} AuditStatus */

export const STATUS = {
  PRESENT_VERIFIED: "present_and_verified",
  PRESENT_UNVERIFIED: "present_but_unverified",
  MISSING: "missing",
  DRIFTED: "drifted",
  BROKEN: "broken",
  UNVERIFIED: "UNVERIFIED",
};
