# Running the Breeze tests

Everything here was run end to end on a clean database before being written down.

The suite lives in this repo. Most of it also needs the **.NET test server** and a
**SQL Server database**, both from the companion repo
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3).

---

## TL;DR

```bash
npm run test:unit      # 184 tests, ~3s, needs nothing at all
```

That is the loop to work in. For the rest you need the database and server running:

```bash
# once, from the breeze-server-v3 checkout
sqlcmd -S . -E -Q "CREATE DATABASE BreezeTestDb"
sqlcmd -S . -E -d BreezeTestDb -f 65001 -i tests/Databases/BreezeTestDb.sql

# leave this running
dotnet run --project tests/Test.AspNetCore.EFCore/Test.AspNetCore.EFCore.csproj \
  --no-launch-profile --urls http://localhost:34377
```

then, from this repo:

```bash
npm test               # 632 tests
```

---

## Prerequisites

| | version used | notes |
|---|---|---|
| Node | 20+ | verified on 24.19.0 |
| .NET SDK | 10.x | verified on 10.0.302 |
| SQL Server | 2016+ | verified on 2022 Developer, default instance |
| `sqlcmd` | any | ships with the SQL Server Client SDK / ODBC tools |

Both repos should be checked out **side by side**:

```
C:\GitHub\
  breeze-client-v3\     <- you are here
  breeze-server-v3\
```

The test database reset looks for the server repo at `../breeze-server-v3`. If yours is
elsewhere, set `BREEZE_TEST_DB_SCRIPT` (see [Configuration](#configuration)).

```bash
npm install
```

---

## 1. Create the test database

All three test models — Northwind, Inheritance and Produce — live in **one** database
called `BreezeTestDb`. From the **breeze-server-v3** checkout:

```bash
sqlcmd -S . -E -Q "CREATE DATABASE BreezeTestDb"
sqlcmd -S . -E -d BreezeTestDb -f 65001 -i tests/Databases/BreezeTestDb.sql
```

That gives you 33 tables and the full Northwind dataset (93 customers, 798 orders, …).

> ### `-f 65001` is not optional
>
> The script is UTF-8 and the Northwind data contains accented characters
> (`México D.F.`, `San Cristóbal`). Without the flag, `sqlcmd` decodes the file as the
> system ANSI codepage and **silently** mangles every one of them — `México` becomes
> `MÃ©xico`. Nothing fails at the time; the damage only shows up much later.
>
> To check it worked:
> ```bash
> sqlcmd -S . -E -d BreezeTestDb -Q "SELECT TOP 1 City FROM Customer WHERE City LIKE 'M%xico%'"
> ```
> You want `México D.F.` — not `MÃ©xico D.F.`

Using a named instance or different credentials? `-S .` is the server, `-E` is Windows
auth. Substitute as needed, and set `BREEZE_SQL_INSTANCE` to match.

### Recreating it

The integration tests mutate data, so the database drifts. **Re-applying the script is
the reset**, and it takes a couple of seconds:

```bash
sqlcmd -S . -E -Q "ALTER DATABASE BreezeTestDb SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE BreezeTestDb; CREATE DATABASE BreezeTestDb;"
sqlcmd -S . -E -d BreezeTestDb -f 65001 -i tests/Databases/BreezeTestDb.sql
```

You rarely need to do this by hand — `npm run test:integration` does it automatically
before every run. `SINGLE_USER WITH ROLLBACK IMMEDIATE` disconnects the running server;
it reconnects on its next query.

### Regenerating the script itself

Only if you change the schema:

```bash
dotnet run --project tools/DbScripter -- tests/Databases/BreezeTestDb.sql
```

Generate it from a **pristine** database. Scripting a database that tests have run
against bakes their leftovers into the seed data.

---

## 2. Start the test server

From the **breeze-server-v3** checkout:

```bash
dotnet run --project tests/Test.AspNetCore.EFCore/Test.AspNetCore.EFCore.csproj \
  --no-launch-profile --urls http://localhost:34377
```

`--no-launch-profile` matters: the default profile in `launchSettings.json` is IIS Express
and will not work here.

Check it:

```bash
curl http://localhost:34377/breeze/NorthwindIBModel/Metadata
```

The server re-seeds the Inheritance tables on every startup, so **restart it after
recreating the database by hand** — otherwise those tables are empty.

---

## 3. Run the tests

| command | tests | needs a server? | time |
|---|---|---|---|
| `npm run test:unit` | 184 | **no** | ~3s |
| `npm run test:integration` | 455 | yes | ~25s |
| `npm test` | 639 | yes | ~28s |
| `npm run test:browser` | 639 | yes | ~30s |
| `npm run test:watch` | 184 | no | watch mode |

7 tests are skipped by design — they target server backends (Sequelize, NHibernate) that
this configuration does not run.

### The unit tier

`test/unit/` — 14 files that need nothing. They work against checked-in metadata fixtures,
or against `AjaxFakeAdapter` where a response is required. No database, no server, files
run in parallel. **This is the tier to iterate against.**

### The integration tier

`test/integration/` — 26 files that query and save real data. Before each run,
`test/global-setup.ts` rebuilds `BreezeTestDb` from the script and re-seeds the
Inheritance tables via `POST /breeze/Inheritance/Seed`.

These share one database, so they run serially in a fixed alphabetical order. That is not
stylistic: a few tests still assert on rows another file created, so changing the order
changes the outcome. Per-file isolation is outstanding work — see `STATUS.md`.

### Browser mode

```bash
npx playwright install chromium   # once
npm run test:browser
```

Runs the same specs in real Chromium against real `fetch` and real CORS. Breeze is a
browser library, so this is the run that matters most; the Node run is the fast default.
Both give identical results.

This needs the server's `BreezeTestCors` policy, which is already in `Startup.cs`. Without
it every request fails preflight.

### Running one file or one test

```bash
npx vitest run --config vitest.unit.config.ts test/unit/predicate.spec.ts
npx vitest run --config vitest.integration.config.ts -t "nullable dateTime"
```

---

## Configuration

Environment variables read by `test/global-setup.ts`:

| variable | default | |
|---|---|---|
| `BREEZE_TEST_SERVER` | `http://localhost:34377` | where the test server is |
| `BREEZE_TEST_DB` | `BreezeTestDb` | database name |
| `BREEZE_SQL_INSTANCE` | `.` | passed to `sqlcmd -S` |
| `BREEZE_TEST_DB_SCRIPT` | `../breeze-server-v3/tests/Databases/BreezeTestDb.sql` | set this if the repos are not siblings |
| `BREEZE_SKIP_DB_RESET` | unset | set to `1` to skip the rebuild |

`BREEZE_SKIP_DB_RESET=1` is useful when re-running one integration test repeatedly and you
do not want to pay for the rebuild each time. Be aware the database then carries whatever
the previous run left behind.

---

## Troubleshooting

**`Unable to find ajax adapter for dataservice adapter 'webApi'`**
Registration order. The data service adapter resolves the ajax adapter when it
initializes, so ajax must be registered first. Use `configureBreeze`, which orders them
correctly by construction. In v3, importing an adapter module no longer registers it.

**Every integration test fails to reach the server**
The server is not running, or not on 34377. Check
`curl http://localhost:34377/breeze/NorthwindIBModel/Metadata`.

**`[db-reset] SKIPPED - script not found`**
`breeze-server-v3` is not a sibling of this repo. Set `BREEZE_TEST_DB_SCRIPT`.

**`[db-reset] failed to rebuild BreezeTestDb`, mentioning truncation**
```
String or binary data would be truncated ... Truncated value: 'San CristÃƒÂ³ba'.
```
The database was built without `-f 65001` and the accented data is corrupted, compounding
on each rebuild. Drop it and recreate with the flag.

**Inheritance tests fail on empty tables**
The database was recreated while the server was running. The server only seeds those
tables at startup — restart it, or `POST http://localhost:34377/breeze/Inheritance/Seed`.

**Browser mode fails every request with a CORS error**
The server predates the `BreezeTestCors` policy. Pull the latest `breeze-server-v3` and
rebuild.

**A test fails once and passes on re-run**
Possible, though the known instance of this is fixed. The integration tests share a
database within a run; if you find one, check whether it depends on data another file
creates — and please note it in `STATUS.md`.
