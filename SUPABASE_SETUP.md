# Supabase contact inbox setup

The portfolio is a static HTML/CSS/JavaScript site. Its contact form and private inbox need a Supabase project; no Supabase credentials, administrator account, or email-provider secret are included in this repository.

## 1. Create the database

1. Create a Supabase project and open **SQL Editor**.
2. Run [`supabase/schema.sql`](./supabase/schema.sql).
3. Keep the Supabase project URL, public anon/publishable key, service-role key, and legacy JWT signing secret in their designated locations. Never put the service-role key or JWT signing secret in website files.

The script creates `contact_messages`, enables RLS, restricts anonymous inserts to the signed submission token minted by the Edge Function, and permits only provisioned administrators to read, update status, or delete. Anonymous users cannot read or manage messages. The private rate-limit table is not exposed through the API.

## 2. Configure the public website

Edit [`supabase-config.js`](./supabase-config.js) and set:

- `url`: the project's Supabase URL, such as `https://project-ref.supabase.co`
- `anonKey`: the project's public anon or publishable key

These are public client settings, not secrets. Do not put a service-role key here. The form stays disabled and explains how to reach Julius directly until the settings are valid.

## 3. Deploy the contact function

Install the Supabase CLI, authenticate, link this repository to the project, and deploy the function. For example:

```text
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy submit-contact
```

Set these function secrets in the Supabase project (Dashboard **Edge Functions → Secrets**, or `supabase secrets set`):

| Secret | Value |
| --- | --- |
| `SITE_URL` | Exact public site origin, for example `https://your-domain.example` (no trailing slash). It is also used for CORS and the inbox link in notification emails. |
| `SUPABASE_URL` | The project URL. |
| `SUPABASE_ANON_KEY` | The same public anon/publishable key configured in `supabase-config.js`. |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's service-role secret; used only for the private rate-limit RPC. Never publish it. |
| `SUPABASE_JWT_SECRET` | The project's legacy JWT signing secret. The function uses it only on the server to mint a short-lived, narrowly claimed `anon` token required by the insert policy. Never publish it. |
| `RATE_LIMIT_HMAC_SECRET` | A randomly generated secret of at least 32 characters used to store keyed hashes rather than raw visitor IP addresses. |
| `NOTIFICATION_EMAIL` | The portfolio owner's notification address. The existing public contact address is `juliussaffa1@gmail.com`; confirm it is still the desired destination before setting this secret. |
| `RESEND_API_KEY` | Resend API key, kept only in function secrets. |
| `RESEND_FROM_EMAIL` | Sender address on a domain verified with Resend. Do not use an unverified or invented sender. |

`supabase/config.toml` disables gateway JWT verification only for this public submission function. The function checks the configured origin and public API key, validates each field again, rejects honeypot submissions, limits each client address to five submissions per 15 minutes, and performs the database insert using the restricted signed `anon` token. It sends a best-effort Resend notification only after the insert succeeds. An email failure does not remove a saved message and is reported as such to the visitor.

The administrator dashboard also needs the public site URL and key in `supabase-config.js`. Do not add a public signup flow.

## 4. Provision the administrator

1. In Supabase **Authentication → Users**, create or invite the administrator yourself. Do not add a registration page or expose account provisioning credentials.
2. Copy that user's UUID and add it to the allowlist in the SQL Editor:

   ```sql
   insert into public.portfolio_admins (user_id)
   values ('<AUTH_USER_UUID>');
   ```

3. Set the site's URL in Supabase Authentication's site/redirect URL settings, then open `/admin/` and sign in with that provisioned account.
4. To revoke access, delete that user's row from `public.portfolio_admins`.

The dashboard checks the administrator allowlist before requesting any inbox data. Database RLS remains the access control even if someone loads the static `/admin/` files directly.

## 5. Verify before publishing

- Submit a test message that you own, then confirm the row appears in `contact_messages`. Do not insert fake visitor messages.
- With the public anon key and no administrator session, verify `SELECT`, `UPDATE`, and `DELETE` requests are denied, and a direct insert without the function-minted claim is denied.
- Verify that the provisioned account can sign in and manage a message, and that an ordinary authenticated account cannot read or change messages.
- Check that the Resend sender domain is verified, a notification arrives at `NOTIFICATION_EMAIL`, and the dashboard link uses the correct `SITE_URL`.
- Verify that a notification failure leaves the database row intact and that the form reports the notification failure accurately.
- Test the contact form and dashboard on the deployed origin at desktop and mobile widths. A local `file://` preview cannot call the configured Supabase function because its origin is not the deployed `SITE_URL`.

Database insertion, RLS behavior, administrator sign-in, message management, and email delivery cannot be verified until project credentials, an administrator account, and provider settings are supplied and the function is deployed.
