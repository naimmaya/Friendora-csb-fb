# Verve Security Specification (Firestore Rules TDD)

## 1. Data Invariants
1. **Verified Identity Gate**: Every read/write across all collections requires a verified Firebase Auth user (`email_verified == true` or verified phone number).
2. **PII Isolation**: Private contact info (`email`, `phone`, `dateOfBirth`) lives strictly in `/users/{userId}/private/info` and is readable/writable ONLY by `request.auth.uid == userId`.
3. **Post Ownership, Page Post Authenticity & Comments Gate**: Only `authorUid == request.auth.uid` can create, edit, turn off comments on, or delete `/posts/{postId}`. Creating a Page post (`pageId != ''`) requires `request.auth.uid in get(/pages/{pageId}).data.adminIds`. Creating a comment is rejected if `posts/{postId}.commentsDisabled == true`; creating a reply (`parentCommentId != ''`) requires the parent comment to exist.
4. **Saved, Hidden & Reported Posts Isolation**: `/saved/{id}`, `/hiddenPosts/{id}`, and `/reports/{id}` are strictly owner-scoped (`userUid == request.auth.uid` or `reporterUid == request.auth.uid`) and require the referenced post to exist on create.
5. **Messenger Presence, Typing & Rich Media**: Users may only update their own `/presence/{uid}` and `/typingStates/{stateId}`. Direct `/messages/{messageId}` are strictly scoped to `participantUids` (size 2); receivers can only update `read: true`.
6. **Group Chats & Multi-Party Group Calls**: Only members (`request.auth.uid in memberUids`) can read a `/groups/{groupId}`, send messages in `/groups/{groupId}/messages`, or join `/groupCalls/{callId}`. Only group admins (`request.auth.uid in adminUids`) can rename the group, change its photo, add/remove members, or manage admins; members may only remove themselves to leave.
7. **Facebook-Style Pages RBAC**: Only the Page `ownerId` can delete a Page or modify `adminIds`. Page `adminIds` can edit Page info and publish Page posts. Non-admin users can ONLY toggle their own UID in `followers` (strictly `+1` or `-1` with all other followers unchanged).
8. **Temporal Integrity**: All `createdAt`, `updatedAt`, `lastSeen`, `startedAt`, and `timestamp` fields are strictly validated against `request.time`.

## 2. Dirty Dozen Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unverified Signup Write**: User with `email_verified: false` attempts to create `/users/{uid}` or `/pages/{pageId}` -> DENIED.
2. **PII Snooping**: User B attempts `get` on `/users/{uidA}/private/info` -> DENIED.
3. **Shadow Field Injection**: User A adds `{isAdmin: true}` to `/users/{uidA}`, `/posts/{postId}`, `/groups/{groupId}`, or `/pages/{pageId}` -> DENIED by `hasOnly`.
4. **Spoofed Page Post**: Non-admin User B tries to create a `/posts/{postId}` with `pageId: pageOwnedByA` -> DENIED by `get(/pages/{pageId}).data.adminIds`.
5. **Commenting When Comments Turned Off**: User B tries to create `/posts/{postId}/comments/{id}` when `commentsDisabled == true` -> DENIED.
6. **Cross-User Saved/Hidden Snooping**: User B tries to list or delete User A's `/saved/{id}` or `/hiddenPosts/{id}` -> DENIED.
7. **Group Chat Intrusion**: Non-member User C tries to read `/groups/{groupId}` or write to `/groups/{groupId}/messages/{id}` -> DENIED.
8. **Non-Admin Group Hijack**: Regular group member User B tries to change `adminUids` or kick User A from `/groups/{groupId}` -> DENIED.
9. **Page Follower Tampering**: Non-owner User B tries to erase other users from `/pages/{pageId}.followers` or add User C's UID -> DENIED by exact `±1` self-UID delta check.
10. **Non-Owner Page Deletion**: Page admin (non-owner) or random user tries to delete `/pages/{pageId}` -> DENIED (`existing().ownerId == request.auth.uid`).
11. **Terminal Call Re-Opening**: User attempts to update `/calls/{callId}` or `/groupCalls/{callId}` after `status == 'ended'` -> DENIED.
12. **Client Timestamp Spoofing**: User sends backdated `createdAt`, `updatedAt`, or `startedAt` != `request.time` -> DENIED.
