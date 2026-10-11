# IPU App — Iyobor Progressive Union

Contributions, loans, interest and year-end payouts for the Iyobor Progressive Union,
replacing the Excel workbook. Built with Next.js, TypeScript, Tailwind CSS, Prisma and PostgreSQL on Supabase.

The approved requirements and system design are in [`docs/`](docs/).

## Run it on your computer

You need Git, Node.js (LTS, version 22 or newer) and VS Code installed.

1. **Get the code.** In VS Code: Source Control → `…` → Pull (or `git pull` in the terminal).
2. **Install the libraries.** Open the terminal in VS Code (`` Ctrl+` ``) and run:
   ```bash
   npm install
   ```
3. **Create the Supabase database.** Sign in at [supabase.com](https://supabase.com) with the union
   email and create a new project named `ipu`. Choose a strong database password made of letters and
   numbers only, and save it somewhere safe. When the project is ready, click **Connect** at the top
   and copy two connection strings: **Transaction pooler** (port 6543) and **Session pooler** (port 5432).
4. **Create your `.env` file.** Copy `.env.example` to a new file named `.env` and fill it in:
   - `DATABASE_URL` — the Transaction pooler string, with your password in place of `[YOUR-PASSWORD]`.
   - `DIRECT_URL` — the Session pooler string, with your password.
   - `SESSION_SECRET` — run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result.
   - `ADMIN_PHONE`, `ADMIN_TEMP_PASSWORD` — your phone number and a temporary password.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — where receipt photos are kept. In Supabase open
     **Project Settings → API Keys**, copy the Project URL and a **Secret key** (`sb_secret_…`). You can leave both
     empty on your computer: receipts are then saved in a local `.uploads` folder (ignored by Git).

   `.env` holds secrets. It is ignored by Git and must never be committed.
5. **Create or update the tables** (first time, and after every `git pull` that brings a new folder in `prisma/migrations`):
   ```bash
   npm run db:deploy
   ```
6. **Add the first data** (your Admin account and the 2026–2027 year):
   ```bash
   npm run db:seed
   ```
7. **Start the app:**
   ```bash
   npm run dev
   ```
   Open <http://localhost:3000>, sign in with your phone number and temporary password,
   and choose a new password.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app at localhost:3000 while you work |
| `npm test` | Run the calculation tests (interest, limits, payouts) |
| `npm run lint` / `npm run typecheck` | Check the code for mistakes |
| `npm run db:studio` | Look inside the database in your browser |
| `npm run build` | Build the live version (Netlify runs this) |

## How the code is organised

| Path | Contents |
| --- | --- |
| `prisma/schema.prisma` | Every table: members, ledger, loans, years, audit log |
| `prisma/seed.ts` | First Admin account, financial year, union settings |
| `src/lib/rules.ts` | **The union's money rules** — interest, loan limit, dividend, payout, exit, default |
| `src/lib/rules.test.ts` | Tests using real figures from the 2025–2026 workbook |
| `src/lib/money.ts` | Naira ↔ kobo conversion and formatting |
| `src/lib/auth.ts`, `session.ts` | Sign-in, roles, 30-minute sessions |
| `src/lib/notify.ts`, `messaging.ts` | Outbox, SMS (Termii) and email sending |
| `src/lib/jobs.ts` | Hourly/daily reminders, guarantor reports, monthly backup |
| `src/app/` | Screens |
| `src/components/` | Shared pieces, including the IPU seal |

## Ground rules

- **Money is kobo.** Every amount is a `bigint` of kobo (₦1 = 100 kobo). Never use decimals for money.
- **The ledger is never edited.** Corrections are new reversing entries.
- **Rules live in one place.** Any change to how interest, limits or payouts work goes in `src/lib/rules.ts` with a test.
- **Every server action checks who is signed in** and their role, even if the button is hidden.

## SMS and email

Every message the app sends (payment received, interest due, reminders, guarantor
notices, year-end payout) goes into an outbox first: **Office → More → Messages**.
Nothing is lost while the providers are not set up; messages wait there.

- **SMS:** set `SMS_PROVIDER="termii"`, `TERMII_API_KEY` and `TERMII_SENDER_ID` (a sender
  name such as `IPU`, registered with Termii; Nigerian networks take a few days to approve it).
  Use `SMS_PROVIDER="log"` to try things without sending real SMS. Another provider can be
  added in `src/lib/messaging.ts` (one function).
- **Email:** for the union Gmail use `SMTP_HOST="smtp.gmail.com"`, `SMTP_PORT="465"`,
  `SMTP_USER="iyoborpu@gmail.com"` and an app password in `SMTP_PASS`.
- The Admin can send a test SMS and run the day's reminders from the Messages page.

## Going live (Netlify)

1. Sign in at [netlify.com](https://netlify.com) with the union email and choose
   **Add new project → Import an existing project → GitHub → festus-oliha/ipu-app**.
   Netlify reads `netlify.toml`; keep the suggested build settings.
2. Before the first deploy, open **Project configuration → Environment variables** and add every
   value from your `.env` except the `ADMIN_*` lines: `DATABASE_URL`, `DIRECT_URL`,
   `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the SMS and email settings,
   and a new `CRON_SECRET` (32+ random characters).
3. Deploy. Each push to `main` then deploys automatically.
4. The hourly function (`netlify/functions/hourly.mts`) starts on the first published deploy and
   runs the reminders in `src/lib/jobs.ts`. Check it under **Logs → Functions → hourly**.
5. When a new folder appears in `prisma/migrations`, run `npm run db:deploy` on your computer
   (it uses `DIRECT_URL`, the live Supabase database) before or right after pushing.
