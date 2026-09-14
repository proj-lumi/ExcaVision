# Contributing to ExcaVision

This repository is designed for a beginner team. You do not need pi. Use a normal editor, VS Code, and the GitHub website (or VS Code's Source Control panel).

## Recommended setup

1. Install Node.js LTS and Git.
2. Install VS Code.
3. Clone the repository from GitHub.
4. Open the repository folder in VS Code.
5. Install dependencies only in the app you are working on:

```bash
cd apps/admin && npm ci
cd ../mobile && npm ci
cd ../landing && npm ci
```

Never commit `.env`, `public/config.js`, Supabase secret keys, or Turnstile secret keys.

## Everyday workflow

1. Open the GitHub issue for your task.
2. Create a branch from the latest `main`:
   - `feat/short-description`
   - `fix/short-description`
   - `docs/short-description`
3. Make one small change at a time.
4. Run the relevant test or build.
5. Commit with a short message such as `feat: add threshold editor`.
6. Push the branch and open a pull request.
7. Ask one teammate to review it.
8. Squash-merge the pull request into `main`.

Do not push directly to `main`, force-push shared branches, or keep long-lived feature branches.

## Before opening a pull request

- Admin changes: `cd apps/admin && npm test -- --watch=false && npm run build`
- Customer PWA changes: `cd apps/mobile && npm run build`
- Landing changes: `cd apps/landing && npm run build`
- Database changes: add a new numbered file under `supabase/migrations/`; never edit a migration that has already been applied.

## Ownership boundaries

- `apps/landing`: public installation onboarding
- `apps/admin`: staff workflow, inventory, installation, and commissioning
- `apps/mobile`: authenticated customer monitoring and service requests
- `supabase`: database, RLS, RPCs, and Edge Functions
- `firmware`: ESP32 node and gateway firmware
- `specs`: CCS6 requirements, design, process, and product decisions

If a change crosses two surfaces, describe the data flow in the pull request instead of silently changing both sides.

## Safe team rules

- Pull `main` before starting new work.
- Keep pull requests small enough to explain in a few sentences.
- Never include credentials in commits or screenshots.
- Ask before changing database permissions, authentication, payment behavior, or hardware protocol.
- If you are unsure, open a draft pull request and explain the question.
