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
     **Project Settings → API**, copy the Project URL and the `service_role` secret. You can leave both
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
| `src/app/` | Screens (login, change password, home) |
| `src/components/` | Shared pieces, including the IPU seal |

## Ground rules

- **Money is kobo.** Every amount is a `bigint` of kobo (₦1 = 100 kobo). Never use decimals for money.
- **The ledger is never edited.** Corrections are new reversing entries.
- **Rules live in one place.** Any change to how interest, limits or payouts work goes in `src/lib/rules.ts` with a test.
- **Every server action checks who is signed in** and their role, even if the button is hidden.

## Going live (Netlify)

Connect this GitHub repository in Netlify, then add `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`,
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under
Site configuration → Environment variables. Each push to `main` deploys automatically.
Run `npm run db:deploy` against the live database when the schema changes.
