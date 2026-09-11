# Running the Breeze tests

Everything here was run end to end on a clean database before being written down.

The suite lives in this repo. Most of it also needs the **.NET test server** and a
**SQL Server database**, both from the companion repo
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3).

---

## TL;DR

```bash
npm run test:unit      # 263 tests, a few seconds, needs nothing at all
```

That is the loop to work in. For everything else, one command creates the database if
needed, starts the test server, runs the tests and stops the server again (Windows):

```bat
scripts\test-with-server.cmd              :: integration tier
scripts\test-with-server.cmd -Tier all    :: integration, then browser
```

It needs SQL Server running locally and `breeze-server-v3` checked out next to this
repo; see [Prerequisites](#prerequisites). To do the same steps by hand, or on another
OS, follow [sections 1–3](#1-create-the-test-database).

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
elsewhere, set `BREEZE_TEST_DB_SCRIPT` (see [Configuration](#configuration)), or pass
`-ServerRepo` to the test script.

```bash
npm install
npx playwright install chromium   # once, for browser mode
```

---

## The test script

`scripts/test-with-server.ps1` runs the server-backed loop in one command:

1. Checks that `node`, `dotnet` and `sqlcmd` are on `PATH`, and that `npm install` has
   been run.
2. Creates `BreezeTestDb` from the server repo's script if it does not exist yet. After
   that, every test run rebuilds it anyway.
3. Reuses a test server already answering on `http://localhost:34377`, and leaves it
   running. Otherwise it starts one with `dotnet run` and waits for it to answer.
4. Runs the chosen tier or tiers.
5. Stops the server it started, and exits with `0` only if every tier passed.

Run it from this repo. From `cmd`, or wherever PowerShell's default execution policy
stops `.ps1` files from running, use the `.cmd` launcher instead; it takes the same
arguments.

```powershell
.\scripts\test-with-server.ps1                  # integration tier
.\scripts\test-with-server.ps1 -Tier browser    # browser tier only
.\scripts\test-with-server.ps1 -Tier all        # integration, then browser
```

| option | |
|---|---|
| `-Tier` | `integration` (the default), `browser`, or `all` |
| `-Filter "text"` | run only the tests whose name matches. A filter that matches nothing fails the run, rather than reporting a pass with every test skipped |
| `-KeepServer` | leave a server the script started running afterwards; it prints the `taskkill` command that stops it |
| `-SkipDbReset` | skip the database rebuild at the start of the run; see [Configuration](#configuration) |
| `-ServerRepo <path>` | the `breeze-server-v3` checkout, if it is not a sibling of this repo |
| `-SqlInstance <name>` | a SQL Server instance other than the local default (`.`) |
| `-StartupTimeoutSeconds <n>` | how long to wait for the server to answer (default 180) |

For a quick loop on one failing test:

```powershell
.\scripts\test-with-server.ps1 -Filter "nullable dateTime" -KeepServer -SkipDbReset
```

The first run starts the server and keeps it; later runs find it and reuse it.

The server's output goes to `%TEMP%\breeze-test-server.log`. The port is fixed at 34377,
because that is where the tests look for the server (`test/test-fns.ts`).
`Get-Help .\scripts\test-with-server.ps1 -Full` has the details.

The script is Windows-only. Elsewhere, follow sections 1–3.

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
| `npm run test:unit` | 263 | **no** | a few seconds |
| `npm run test:integration` | 455 | yes | ~25s |
| `npm test` | 718 (unit + integration) | yes | ~30s |
| `npm run test:browser` | 718 | yes | ~35s |
| `npm run test:watch` | 263 | no | watch mode |

7 tests are skipped by design. Five are skipped on the ASP.NET Core server: three need
server-side validation, which that server does not perform; one needs a named-query endpoint
it does not implement; one checks the handling of a bad-parameter error that is not finished
yet. The other two are always skipped: one is awaiting review, and one covers a known bug
(`bugs.spec.ts`).

### The unit tier

`test/unit/` — 21 files that need nothing. They work against checked-in metadata fixtures.
Where a test needs a server response, it supplies a fake `fetch` through
`configureBreeze({ fetch })` (`fetch-transport.spec.ts` shows how), or, to cover the
deprecated ajax adapter path, registers `AjaxFakeAdapter` from `test/support/`. No
database, no server, files run in parallel. **This is the tier to iterate against.**

### The integration tier

`test/integration/` — 26 files that query and save real data. Before each run,
`test/global-setup.ts` rebuilds `BreezeTestDb` from the script and re-seeds the
Inheritance tables via `POST /breeze/Inheritance/Seed`.

The suite registers no ajax adapter, so every request goes through `config.fetch`: the
same default path an application gets.

These files share one database, so they run serially in a fixed alphabetical order. That
is not stylistic: a few tests still assert on rows another file created, so changing the
order changes the outcome. Per-file isolation is outstanding work — see `STATUS.md`.

### Browser mode

```bash
npx playwright install chromium   # once
npm run test:browser
```

Runs the unit and integration specs in real Chromium against real `fetch` and real CORS.
Breeze is a browser library, so this is the run that matters most; the Node run is the
fast default. Both give identical results.

This needs the server's `BreezeTestCors` policy, which is already in `Startup.cs`. Without
it every request fails preflight.

### Running one file or one test

```bash
npx vitest run --config vitest.unit.config.ts test/unit/predicate.spec.ts
npx vitest run --config vitest.integration.config.ts -t "nullable dateTime"
```

`-t` (and the script's `-Filter`) is matched against the full test name, including the
names of its `describe` blocks.

---

## Configuration

Environment variables read by `test/global-setup.ts`. The test script sets them for you
from its options.

| variable | default | |
|---|---|---|
| `BREEZE_TEST_SERVER` | `http://localhost:34377` | where the test server is |
| `BREEZE_TEST_DB` | `BreezeTestDb` | database name |
| `BREEZE_SQL_INSTANCE` | `.` | passed to `sqlcmd -S` |
| `BREEZE_TEST_DB_SCRIPT` | `../breeze-server-v3/tests/Databases/BreezeTestDb.sql` | set this if the repos are not siblings |
| `BREEZE_SKIP_DB_RESET` | unset | set to `1` to skip the rebuild |

`BREEZE_SKIP_DB_RESET=1` (the script's `-SkipDbReset`) is useful when re-running one
integration test repeatedly and you do not want to pay for the rebuild each time. Be
aware the database then carries whatever the previous run left behind.

---

## Troubleshooting

**Every integration test fails to reach the server**
The server is not running, or not on 34377. Check
`curl http://localhost:34377/breeze/NorthwindIBModel/Metadata`, or let the test script
start it.

**`[db-reset] SKIPPED - script not found`**
`breeze-server-v3` is not a sibling of this repo. Set `BREEZE_TEST_DB_SCRIPT`, or pass
`-ServerRepo` to the script.

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

**"running scripts is disabled on this system"**
PowerShell's execution policy blocks `.ps1` files. Use `scripts\test-with-server.cmd`,
which runs the script with the policy bypassed for that one run.

**`'sqlcmd' was not found on PATH`** (or `node`, or `dotnet`)
Install the missing tool from [Prerequisites](#prerequisites), then open a new terminal
so the updated `PATH` is picked up.

**`Could not connect to SQL Server '.'`**
SQL Server is not running, or it is a named instance: pass `-SqlInstance`, for example
`-SqlInstance .\SQLEXPRESS`.

**`The test server exited during startup`**
The script prints the last lines of `%TEMP%\breeze-test-server.log`. The usual causes are
another program already using port 34377, or a build error in `breeze-server-v3`.

**`No test in the integration tier matched -Filter '...'`**
Nothing matched the filter. It is matched against the full test name, including its
`describe` blocks, so check the spelling against the test file.

**`(!) Your Vite config uses features that are unsupported by configLoader: 'native'`**
Harmless. Every run prints it; it concerns a future Vite default, not the tests.

---

## Building the docs

Separate from the tests, but same toolchain:

```bash
npm run docs:dev       # local server with hot reload
npm run docs:build     # static site to docs/.vitepress/dist
npm run docs:preview   # serve the built site
npm run docs:api       # regenerate just the API markdown
```

`docs:dev` and `docs:build` run TypeDoc first, so the API reference is always in step
with the source. Both `docs/api/` (generated) and `docs/.vitepress/dist/` are gitignored.
