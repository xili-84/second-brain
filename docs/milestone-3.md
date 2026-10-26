# Milestone 3: review and organization

Status: accepted on Windows and the Huawei P40 Pro on 2026-07-24.

## Goal

Complete the second half of the product principle: review inbox captures, correct their content,
move them through a simple lifecycle, and remove records that are no longer useful.

## Scope

- Inbox, reviewed, and archived views
- Capture detail view
- Edit note title/body or link title/URL
- Mark an inbox capture reviewed
- Move a reviewed capture back to the inbox
- Archive an inbox or reviewed capture
- Restore an archived capture to the inbox
- Permanently delete after explicit confirmation
- Explicit loading, success, and failure states
- Retain unsaved edits after a failed request
- Shared behavior on Windows and in the Capacitor APK

No database migration is required because the existing schema and RLS policies already support all
operations.

## Excluded

- Images and Android image sharing
- Tags
- Favorites
- Search
- Link metadata
- Bulk actions
- Offline mode
- Collaboration and administration

## Acceptance criteria

1. Each lifecycle view shows only captures with its corresponding status, newest first.
2. Opening a capture displays its current owned data.
3. Editing updates the existing record without creating a duplicate.
4. A failed edit displays no success and retains every entered change.
5. Inbox, reviewed, archived, and restored status transitions set `archived_at` consistently.
6. Deletion requires a second explicit confirmation.
7. A confirmed deletion removes the capture from Android and Windows.
8. Unauthenticated and cross-user access remains denied by RLS.
9. No excluded feature is exposed.
10. Web checks, Android lint, and APK assembly pass.

## Acceptance result

The complete lifecycle passed manual acceptance on Windows and in the Capacitor Android application:
captures loaded in the correct status view, edits persisted across devices, status transitions
appeared in the corresponding views, restoration returned captures to the inbox, and permanent
deletion required confirmation and removed the record from both clients.

The automated web suite, production PWA build, Android lint, and debug APK assembly also passed.
Milestone 3 required no database migration. Production deployment remains a separate manual
Namecheap step.
