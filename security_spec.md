# Firestore Security Specification

## Data Invariants
1. **Default Deny**: All paths outside `/users/{userId}` and `/users/{userId}/private/info` are denied for both reads and writes.
2. **PII Isolation (Split Collections)**: `/users/{userId}` holds only non-PII public display fields (`name`, `bio`, `location`, `work`, `avatarUrl`, `coverUrl`). All PII (`email`, `phone`, `dateOfBirth`) is isolated in `/users/{userId}/private/info`, readable and writable exclusively by the authenticated owner (`userId == request.auth.uid`).
3. **Verified Identity Gate**: Writes require an authenticated user whose email is verified (`request.auth.token.email_verified == true`) or whose phone number is verified by Firebase Phone Auth (`request.auth.token.phone_number is string`).
4. **Immutable Ownership & Timestamps**: `uid` and `createdAt` are immutable after creation; `createdAt` on create and `updatedAt` on update must equal `request.time`.
5. **Permanent Preservation**: Client-side deletion of `/users/{userId}` and `/users/{userId}/private/info` is forbidden so accounts persist across logouts, refreshes, and redeploys.
6. **Master Gate Sync**: `/users/{userId}/private/info` requires its parent `/users/{userId}` document to exist (`existsAfter` on create, `exists` on update).

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Write**: Create `/users/user_1` with `request.auth == null`.
2. **Unverified Email Write**: Create `/users/user_1` with `email_verified: false` and no `phone_number`.
3. **Identity Spoofing**: Signed in as `user_1`, attempt to create `/users/user_2` or set `uid: "user_2"`.
4. **Shadow / Ghost Field Injection**: Create `/users/user_1` with extra key `isAdmin: true` or `role: "admin"`.
5. **Path ID Poisoning**: Create `/users/../../evil$id` or 200-character document ID.
6. **PII Cross-User Read**: Signed in as `user_2`, attempt `get` on `/users/user_1/private/info`.
7. **Blanket Collection Scraping**: Signed in as `user_2`, attempt unrestricted `list` on `/users` without `where('uid', '==', 'user_2')`.
8. **Immutable Field Tampering**: Signed in as `user_1`, update `/users/user_1` modifying `createdAt` or `uid`.
9. **Client Timestamp Forgery**: Create `/users/user_1` with `createdAt` set to a past timestamp instead of `request.time`.
10. **Value Poisoning / Size Exhaustion**: Update `/users/user_1` setting `bio` to a 5000-character string or a boolean.
11. **Orphaned Private Subcollection**: Create `/users/user_1/private/info` when parent `/users/user_1` does not exist.
12. **Account Deletion Attack**: Signed in as `user_1`, attempt `delete` on `/users/user_1` or `/users/user_1/private/info`.
