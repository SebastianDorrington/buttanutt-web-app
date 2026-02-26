# Production reporting web app

Two roles: **admin** and **production manager**. Data is stored in SQLite (`data/app.db`). UI uses company colours (black and white). Add `logo.png` to the `public` folder to show your logo on the login page and in the top-left of the manager and admin screens.

## Setup

```bash
cd seb_applications/web_app
npm install
```

## Run

```bash
npm start
```

Open http://localhost:3000

## Log in

- **Production manager:** username `johndoe`, password `123`
- **Admin:** username `admin`, password `123`

## Production manager

1. **Log weekly targets** – Date in DD/MM/YYYY (default: Monday of current week). Pick a **variant** from the dropdown and enter **units**. Targets can only be set for the current week or future weeks (from Monday), not past weeks.
2. **Log daily actual production** – Date (DD/MM/YYYY), variant, units, **hours spent**, and optional **note** (max 250 characters, e.g. reason for shortfall).
3. **View target vs production** – Table by week: Week, Variant, Target, Produced, % of target (all left-aligned, one row per variant per week).
4. **Delete most recent** – Delete your most recent weekly target row or your most recent daily actual.

## Admin

**Permissions** tab:

- **Users** – List, add, edit (name, surname, personal note, password), remove. Note is only visible to admin.
- **Variants** – Add, edit, remove variants. Managers see only variants you allow (see Manager variant access).
- **Manager variant access** – Choose which variants each production manager can see. By default a manager sees all variants; deselect to restrict.
- **Export** – Download CSV of all weekly targets and all daily production (with date, variant, units, hours, note).

**Summary** tab:

- Select a production manager to view their **target vs production by week** in a table.

## Deploying on a Raspberry Pi

To run the app on a Raspberry Pi 4 (e.g. plugged into the company router) so it stays online whenever the Pi is on, see **[DEPLOY-RASPBERRY-PI.md](DEPLOY-RASPBERRY-PI.md)**. That guide covers copying the app, installing Node and dependencies, and running it as a system service that starts on boot and restarts on failure.

## Database

SQLite file: `data/app.db`. Tables: `users`, `variants`, `manager_variant_access`, `weekly_targets`, `daily_production`. Created on first run. Default variants are seeded; admin can add, edit or remove them.
