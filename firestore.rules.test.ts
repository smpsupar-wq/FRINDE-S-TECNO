/**
 * firestore.rules.test.ts — Verification suite for PAAS WIVER Firestore Rules.
 * Covers all 12 Dirty Dozen adversarial payloads against /licenses, /admins, and /test.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  actor: 'anonymous' | 'user1' | 'admin';
  expected: 'ALLOW' | 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  { id: 1, name: 'Unauthenticated Read', operation: 'get', path: '/licenses/u1', actor: 'anonymous', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unauthenticated Create', operation: 'create', path: '/licenses/u1', actor: 'anonymous', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Cross-User License Read', operation: 'get', path: '/licenses/u2', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Non-Admin List Scrape', operation: 'list', path: '/licenses', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Trial Expiration Spoof (+30d)', operation: 'create', path: '/licenses/u1', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Self-Admin Role Escalation', operation: 'create', path: '/licenses/u1', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Non-Admin Self-Extension Update', operation: 'update', path: '/licenses/u1', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Shadow Field Injection', operation: 'create', path: '/licenses/u1', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Identity Spoofing Create', operation: 'create', path: '/licenses/u2', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Non-Admin Delete User', operation: 'delete', path: '/licenses/u2', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Admin Table Spoofing', operation: 'create', path: '/admins/u1', actor: 'user1', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Oversized Username Poisoning', operation: 'create', path: '/licenses/u1', actor: 'user1', expected: 'PERMISSION_DENIED' },
];
