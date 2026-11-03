# ESNS PM Dashboard

Incorta appkit app (TanStack Start stack) that replaces the Incorta dashboard
**"Detailed ESNS PM Dashboard New"** (ESNS Testing Dashboards › ESNS Project
Controls) and folds its embedded cost-input app (Tab 4) into the same app.

One job selector and an **As of** date (defaults to the most recent Sunday, as
`$Past_Sunday` did) drive four tabs:

| Tab | Replaces | Data |
| --- | --- | --- |
| **PM Dashboard** | "Total Project Performance", "Weekly Performance", "Total Project Performance – Cost Codes" | Job header; this week vs last week by cost type; budget (EST) vs spend (JC), daily/weekly/monthly averages, remaining, by cost type and by cost code; weekly spend trend |
| **PO & SC** | "PO & SC" tab | PO and subcontract lines: ordered, received/invoiced, remaining (qty and $), unit price, paid |
| **Invoicing** | "Invoicing" insight | AR invoices (accounts 115010/115031/115040): amount, received, outstanding, days open |
| **Cost Performance Tracker** | Tab 4 iframe (`incorta-prod-esnscostinput.layout-app.com`) | Editable 13-week Baseline / Forecast / EV grid by cost type (BL, BS, BT1, BM, BC), KPI tiles (CPI = EV ÷ Forecast, PF = EV ÷ Baseline), and read-only Penta actuals for comparison |

## Data sources (ES Prod)

All Incorta reads go through the SQL Interface **as the signed-in user**, so
Incorta row security applies. Incorta is read-only from the app.

| Original field | Read from | Why |
| --- | --- | --- |
| `Penta_Business.Project_Labor.*` | `Penta_Projects.Job_Cost_Stacked_1A` | The business view isn't queryable over SQL; this is its physical source. `type` = `JC` (actual) / `EST` (budget). ~567M rows, so every query filters `job_id`. |
| `Penta_Business.Job.Project_Manager` / `Project_Engineer` | `Penta.JOB.pmgr_emp_id` / `proj_engineer_emp_id` → `Penta.EMPLOYEE` | The formula columns return `#ERROR` over SQL |
| Job header fields | `Penta_Business.Job` | |
| Cost code / type descriptions | `Penta_Projects.PM_Cost_Code` (per job), `Penta.COST_TYPE` | |
| Invoicing | `Penta.AR_BH_BASE` (`dr_acct_num IN (115010,115031,115040)`) | |
| PO & SC | `PO_DTL`, `PO_MSTR`, `BI40_PO_PRC_HIST`, `BI40_SC_PRC_HIST`, `AP_PH_BASE`, `Penta.VENDOR` | Price history is matched on PO number and line, because `pph_po_co_job_id` is only set on change orders |

All SQL is in `src/server/queries.server.ts`.

### Tracker storage

ES Prod has no write-back table for weekly Baseline/Forecast/EV. The tracker
stores its inputs in the app's own platform Postgres (`db/schema.ts` →
`cost_tracker_entries`, one row per job × cost type × series × week ending, with
`updated_by` and `updated_at`). A save is rejected unless the user can see the
job under their own Incorta row security.

When the tracker compares inputs with Penta actuals, burden and variant codes
roll up into their parent row: BLB→BL, BSB→BS, BT2/BT3→BT1, BC1–4→BC
(`src/server/costTypes.ts`).

## Layout

```
db/schema.ts                  app-owned tables (Drizzle) + db/snapshot.json
src/server.ts                 auth-gate entry        (LOCKED — platform file)
src/server/auth.ts            Incorta session helper (LOCKED — platform file)
run.sh                                               (LOCKED — platform file)
src/server/incorta.ts         SQL Interface helper (template)
src/server/queries.server.ts  all Incorta SQL
src/lib/api/pm.functions.ts   server functions called by the UI
src/server/tracker.server.ts  tracker persistence
src/server/demo.server.ts     sample data when there is no Incorta SQL endpoint
src/routes/index.tsx          header, job picker, tabs
src/components/*              tab views and the tracker grid
src/app.css                   app styles (on top of @incorta/ui)
```

Client code must not import from `src/server/**` (the build fails if it does),
so server functions live in `src/lib/api/`.

## Checks

```bash
bun install
bun run typecheck && bun test test && bun run build
```

## Incorta appkit

| Env | App id |
| --- | --- |
| ES Prod: `https://energysolutions-prod.cloud4.incorta.com/incorta` | `ugkao82s5pjasgr5` (see `.appkit-target`) |

After changing `db/schema.ts`, regenerate `db/snapshot.json` (appkit-push
`snapshot.sh`) and commit both. A push makes a preview version; publishing
creates the production tables and makes the app live.
