# Supabase setup checklist

Status: completed on 2026-07-24. The migration was applied through versioned CLI history and the
resulting RLS policies, anonymous denial, and private Storage bucket were verified.

Do not perform this checklist until the plan and existing SQL migration have been approved. Never
share a password, secret key, service-role key, database password, or access token in project files
or chat.

## 1. Create the project

1. Sign in to Supabase and create a new project in the intended organization.
2. Give it a recognizable name such as **Second Brain**.
3. Select **Central EU (Frankfurt)**. This is the recommended region for a user in Europe and should
   be chosen carefully because changing region later requires migration to a new project.
4. Generate a strong database password, save it in a password manager, and wait for provisioning to
   finish.

## 2. Lock down authentication

1. Open **Authentication > Providers > Email** and keep email/password authentication enabled.
2. Open the authentication general settings and turn off **Allow new users to sign up**.
3. Keep anonymous sign-ins disabled.
4. Do not enable magic links, phone authentication, social providers, or CAPTCHA for this
   single-user milestone.
5. In **Authentication > Users**, create the initial user with the owner's email and a strong
   password. Mark the email confirmed if the dashboard offers that option.
6. Test sign-in only after the application has been configured. There must be no sign-up screen.

## 3. Copy only browser-safe project values

1. Open the project's API settings.
2. Copy the project URL.
3. Copy the current publishable key, whose name begins with `sb_publishable_`. If the project only
   presents legacy keys, use the legacy `anon` key, never `service_role`.
4. In the project root, copy `.env.example` to `.env.local`.
5. Set:

   ```text
   VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

6. Confirm `.env.local` remains ignored by Git. Values prefixed with `VITE_` are included in client
   builds, so only the publishable key belongs there.

## 4. Apply the reviewed migration safely

The preferred path uses a pinned Supabase CLI development dependency so migration history remains
consistent. It connects to the remote project but does not require Docker.

1. Review `supabase/migrations/202607240001_initial_schema.sql` again and confirm its checksum or
   Git diff is unchanged from the approved version.
2. Install the pinned project dependencies.
3. From the project root, authenticate the Supabase CLI locally:

   ```powershell
   npx supabase login
   ```

4. Link this repository to the new project using the reference from its dashboard URL:

   ```powershell
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

   Keep access tokens and the database password out of Git and documentation.

5. Run a remote migration dry run and inspect that only the one reviewed migration is pending:

   ```powershell
   npx supabase db push --dry-run
   ```

6. Apply it once:

   ```powershell
   npx supabase db push
   ```

7. Confirm the remote migration history:

   ```powershell
   npx supabase migration list
   ```

8. Do not paste the migration into the SQL Editor as an alternative; doing so would bypass the
   repository's migration history.
9. Record the successful migration in the project log without recording credentials.

## 5. Verify the security boundary

1. In **Table Editor**, confirm `captures`, `attachments`, `tags`, and `capture_tags` exist.
2. Confirm Row Level Security is enabled on all four tables.
3. In the policy view, confirm each table has owner-scoped select, insert, update, and delete
   policies for `authenticated`; there must be no `anon` policies.
4. In **Storage**, confirm `capture-images` exists and is private.
5. Confirm its limit is 10 MiB and its allowed MIME types are exactly `image/jpeg`, `image/png`, and
   `image/webp`.
6. Confirm Storage object policies limit access to paths whose first folder is the signed-in
   user's UUID.
7. Use Supabase's security advisor and resolve any warning caused by this migration before moving
   on.
8. After the application client exists, verify that an unauthenticated request cannot read a
   capture, the owner can read their own row, and a row with another `user_id` cannot be inserted or
   read.

Do not create fake captures or seed records for verification. Use one clearly identified real test
capture through the completed form, then remove it if desired.
