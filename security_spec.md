# Security Specification — PAAS WIVER Firebase Licensing

## 1. Data Invariants
1. **Identity Binding**: Every `/licenses/{userId}` document must satisfy `uid == userId` and `ownerUid == userId`.
2. **Server-Enforced 10-Minute Free Trial Cap**: Non-admin self-registration (`isSelfTrialCreate`) can only set `expiresAt <= request.time + duration.value(11, 'm')`, `role == 'user'`, `status == 'trial'`, and `trialGranted == true`.
3. **Admin-Only Extensions & Deletions**: Only `isAdmin()` can extend `expiresAt`, change `status` to `'active'`, list all `/licenses`, or delete any `/licenses/{userId}` document.
4. **Immutable Core Fields**: `uid`, `ownerUid`, `username`, `createdAt`, `trialGranted`, and `role` cannot be altered by non-admin users on update.
5. **Temporal Integrity**: `createdAt` on create and `updatedAt` on create/update must equal `request.time`.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: `get /licenses/u1` with `auth == null`.
2. **Unauthenticated Create**: `create /licenses/u1` with `auth == null`.
3. **Cross-User Read**: `get /licenses/u2` as `auth.uid == 'u1'`.
4. **Non-Admin List Scrape**: `list /licenses` as non-admin `auth.uid == 'u1'`.
5. **Trial Time Spoof**: `create /licenses/u1` with `expiresAt = request.time + 30 days` as non-admin `u1`.
6. **Self-Admin Role Escalation**: `create /licenses/u1` with `role: 'admin'` as non-admin `u1`.
7. **Self-Extension Update**: `update /licenses/u1` modifying `expiresAt` as non-admin `u1`.
8. **Shadow Field Injection**: `create /licenses/u1` with extra ghost field `isVerified: true`.
9. **Identity Spoofing**: `create /licenses/u2` while signed in as `auth.uid == 'u1'`.
10. **Non-Admin Delete**: `delete /licenses/u2` as `auth.uid == 'u1'`.
11. **Admin Table Spoofing**: `create /admins/u1` as non-admin `u1`.
12. **Oversized Username Poisoning**: `create /licenses/u1` with 500-character `username`.
