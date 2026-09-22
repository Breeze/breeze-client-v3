# Running the Breeze tests

Everything here was run end to end on a clean database before being written down.

The suite lives in this repo. Most of it also needs the **.NET test server** and a
**SQL Server database**, both from the companion repo
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3).

---

## TL;DR

```bash
npm run test:unit      # a few seconds, needs nothing at all
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

### Windows 11: check Smart App Control first

Smart App Control blocks unsigned binaries, and a locally built server assembly is always
unsigned — so where it is enforced, the test server cannot start at all and every
server-backed tier fails. It costs a minute to rule out:

```powershell
Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy |
  Select-Object VerifiedAndReputablePolicyState   # 0 = off, 1 = enforced, 2 = evaluation
```

`1` means the server-backed tiers will fail until it is turned off; see
[Troubleshooting](#troubleshooting), under **`An Application Control policy has blocked this
file`**, which covers both turning it off and the alternative if you would rather not.

This affects few machines. Smart App Control is a Windows 11 consumer feature that is on only
where Windows was clean-installed and left enabled; it is off on machines upgraded from
Windows 10, and does not exist on Windows 10, macOS or Linux. An organisation's WDAC policy
behaves the same way but is not yours to switch off — event 3077 names the policy, so the
check in the troubleshooting entry tells the two apart. `npm run test:unit` needs no server
and works either way.

---

## The test script

`scripts/test-with-server.ps1` runs the server-backed loop in one command:

1. Checks that `node`, `dotnet` and `sqlcmd` are on `PATH`, and that `npm install` has
   been run.
2. Creates `BreezeTestDb` from the server repo's script if it does not exist yet. After
   that, every test run rebuilds it anyway.
3. Reuses a test server already answering on `http://localhost:34377`, and leaves it
   running. Otherwise it starts one with `dotnet run ... --TestDb:AllowReset=true` and
   waits for it to answer. A server you start yourself needs that option too; see
   [section 2](#2-start-the-test-server).
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
sqlcmd -S . -E -Q "IF DB_ID('BreezeTestDb_TestSnapshot') IS NOT NULL DROP DATABASE BreezeTestDb_TestSnapshot; ALTER DATABASE BreezeTestDb SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE BreezeTestDb; CREATE DATABASE BreezeTestDb;"
sqlcmd -S . -E -d BreezeTestDb -f 65001 -i tests/Databases/BreezeTestDb.sql
```

You rarely need to do this by hand — `npm run test:integration` does it automatically
before every run, then resets the database before every spec file (see
[The integration tier](#the-integration-tier)). Those runs leave a database snapshot,
`BreezeTestDb_TestSnapshot`, behind; the first statement drops it, because a database
that has a snapshot cannot be dropped. `SINGLE_USER WITH ROLLBACK IMMEDIATE` disconnects
the running server; it reconnects on its next query.

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
  --no-launch-profile --urls http://localhost:34377 --TestDb:AllowReset=true
```

`--no-launch-profile` matters: the default profile in `launchSettings.json` is IIS Express
and will not work here.

`--TestDb:AllowReset=true` switches on the test host's `/breeze/TestDb` endpoints, which
the integration tests use to snapshot the database and reset it before every file. Without
it they answer 404, and the integration tests stop at once with
`[db-reset] POST .../breeze/TestDb/Snapshot returned 404`.

Check it:

```bash
curl http://localhost:34377/breeze/NorthwindIBModel/Metadata
```

The server re-seeds the Inheritance tables on every startup, so **restart it after
recreating the database by hand** — otherwise those tables are empty.

---

## 3. Run the tests

| command | tier | tests | needs a server? | time |
|---|---|---|---|---|
| `npm run test:unit` | unit | 744, 58 files | **no** | ~15s |
| `npm run test:integration` | integration | 478 (477 + 1 skipped), 33 files | yes | ~48s |
| `npm test` | both | 1222 (1221 + 1 skipped), 91 files † | yes | ~63s |
| `npm run test:browser` | both, in Chromium | 1094 (1093 + 1 skipped), 86 files ‡ | yes | ~59s |
| `npm run test:retention` | retention | 17, 1 file | **no** | ~2s |
| `npm run test:watch` | unit | 744 | no | watch mode |

All of these were measured on 2026-09-22, on the same clean database, except the `npm test`
row † — that is the sum of the unit and integration runs, which together are exactly what the
command runs; it was not observed as a single run.

These counts are a snapshot, not a contract: they drift every time a spec is added, and
nothing checks them. Treat a disagreement as this table being out of date. What the tiers
*are* — what each needs, and why the browser tier is smaller — is in the sections below and in
the `vitest.*.config.ts` headers, which is where to look when the numbers no longer match.

‡ The browser tier is five files short of `npm test`, and the five are listed in
`vitest.browser.config.ts`: they read `src/` off disk, spawn a child process, drive the
TypeScript language service, or ask V8 for a garbage collection. None of that exists in
Chromium, and all of it checks the repository rather than runtime behaviour. The retention
tier is excluded for the same reason.

One test is skipped, in `bugs.spec.ts`, and it covers a known bug. The conditional skips that
used to switch whole files on and off per server flavour are gone — see the note in
`test/test-fns.ts`.

### The unit tier

`test/unit/` — the specs that need nothing. They work against checked-in metadata fixtures.
Where a test needs a server response, it supplies a fake `fetch` through
`configureBreeze({ fetch })` (`fetch-transport.spec.ts` shows how), or, to cover the
deprecated ajax adapter path, registers `AjaxFakeAdapter` from `test/support/`. No
database, no server, files run in parallel. **This is the tier to iterate against.**

### The retention tier

`test/retention/` — leak tests. `npm run test:retention`, no server, under a second.

They ask one question: once an entity is out of the cache, does anything in the library still
point at it? Each case keeps the `EntityManager` and its `MetadataStore` alive — which is the
situation that matters, since an application holds a manager for a long time and a store for
longer — takes a `WeakRef` to an entity, drops every other reference, forces a full garbage
collection, and asks whether the entity survived.

Two rules make these trustworthy rather than decorative:

- **Assert what is reachable, never how many bytes are in use.** A heap-size threshold is a CI
  flake, the same reason the timing assertions were dropped in `relation-array-clear.spec.ts`.
  A `WeakRef` is exact: the object is there or it is not.
- **Keep a control.** `but an ATTACHED entity is not released` has to fail if the collector is
  not actually running, otherwise every other test in the file passes for the wrong reason.

`test/support/retention.ts` has the two helpers, and they answer different questions:

| helper | question | use it for |
|---|---|---|
| `isReleased(make)` | did this survive a full GC? | the assertion |
| `pathsTo(root, target)` | how is it reached? | the diagnosis, when `isReleased` says no |

**Do not assert with `pathsTo`.** It only sees what its walk reaches, and the first version
written for this repo skipped `entityType` as "shared metadata, not the suspect" — which is
exactly where the leak it was hunting turned out to live, so it reported a clean bill of health
for an entity that was pinned sixteen ways. The collector has no skip list; a graph walk has
whatever one you gave it.

Forcing a collection does not need `--expose-gc`. The flag does not reach a Vitest worker, because
the pool forks its children and they do not inherit it, so `retention.ts` asks V8 for the function
through `node:v8` and `node:vm` instead. That is also why the tier is excluded from browser mode:
there is no forced collection in Chromium.


### The integration tier

`test/integration/` — the specs that query and save real data. Every file starts from the
same, pristine database:

1. Once per run, `test/global-setup.ts` rebuilds `BreezeTestDb` from the script, re-seeds
   the Inheritance tables via `POST /breeze/Inheritance/Seed`, and has the server take a
   SQL Server database snapshot of the result (`POST /breeze/TestDb/Snapshot`).
2. Before each file, `test/integration-setup.ts` has the server revert the database to
   that snapshot (`POST /breeze/TestDb/Reset`). The revert takes about 0.2 seconds, but
   it leaves the database cache cold and the connection pool empty; all told it adds about
   10 seconds to a run. It goes over HTTP rather than `sqlcmd`, so browser mode does the same.

So each file passes on its own, and in any order. A test may rely on the shipped data and
on what earlier tests *in its own file* did, but never on another file: if it needs a row
the shipped data lacks, such as an order with no customer, it creates it.

The suite registers no ajax adapter, so every request goes through `config.fetch`: the
same default path an application gets.

The files still run one at a time (`fileParallelism: false`): there is one database, and a
reset would pull it out from under a file running alongside. Their order is shuffled on
every run, which keeps them honest. The seed is printed at the top of the run:

```
      Running tests with seed "1789154820041"
```

To repeat that order, pass it back:

```bash
npx vitest run --config vitest.integration.config.ts --sequence.seed=1789154820041
```

Tests within a file always run in the order they are written.

The two endpoints belong to the test host in `breeze-server-v3`
(`tests/Test.AspNetCore.EFCore/Controllers/TestDbController.cs`), not to any Breeze
package. They are off unless the host is started with `--TestDb:AllowReset=true`, and
even then answer only requests from the local machine. Snapshots need SQL Server 2016 SP1
or later, in any edition.

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

### Type-checking the tests

```bash
npm run typecheck        # the library, then the tests
npm run typecheck:test   # just the tests
```

The tests have their own project, `test/tsconfig.json`, which VS Code uses for every file
under `test/`. It knows Vitest's globals (`describe`, `test`, `expect`), the `jest-extended`
matchers and the JSON fixtures. If spec files still show red squiggles after pulling this,
run **TypeScript: Restart TS Server** from the command palette.

The tests are checked without `strictNullChecks`, which the library itself keeps on. They
were written for 2.x and deliberately work with nulls and lookups that can fail.
`noImplicitAny` stays on for both.

### Running one file or one test

```bash
npx vitest run --config vitest.unit.config.ts test/unit/predicate.spec.ts
npx vitest run --config vitest.integration.config.ts -t "nullable dateTime"
```

`-t` (and the script's `-Filter`) is matched against the full test name, including the
names of its `describe` blocks.

An integration file run on its own sees the same data it sees in a full run: it resets the
database first either way.

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
| `BREEZE_SKIP_DB_RESET` | unset | set to `1` to skip the rebuild; files still reset to the last snapshot |

`BREEZE_SKIP_DB_RESET=1` (the script's `-SkipDbReset`) is useful when re-running one
integration test repeatedly and you do not want to pay for the rebuild each time. It skips
only the rebuild and the new snapshot: each integration file still resets the database,
to the snapshot the last full run took. With no snapshot yet, every file fails with
`No snapshot 'BreezeTestDb_TestSnapshot' of 'BreezeTestDb' to reset to`; run once without it.

---

## Troubleshooting

**Every integration test fails to reach the server**
The server is not running, or not on 34377. Check
`curl http://localhost:34377/breeze/NorthwindIBModel/Metadata`, or let the test script
start it.

**`No test files found`, then `[db-lock] another test run is using BreezeTestDb`**
Another run of the integration or browser tier — or plain `npm test` — is using the database.
Every such run rebuilds `BreezeTestDb` first and reverts it before each spec file, so two at once
wreck each other in ways that look like real bugs: spec files failing in setup with most of their
tests skipped, `[db-reset] inheritance seed returned 500`, foreign-key conflicts from rows the
other run removed. So the second run refuses to start. Vitest's `No test files found` above it
only means the setup stopped before collecting any.

Wait for the other run to finish; the message names its pid and command. If there is no such run
— one killed hard can leave the file behind, though a run normally takes over a lock whose process
has gone — delete the file the message names. The unit and retention tiers do not use the database
and take no lock.

**`[db-reset] script not found`**
`breeze-server-v3` is not a sibling of this repo. Set `BREEZE_TEST_DB_SCRIPT`, or pass
`-ServerRepo` to the script.

**`[db-reset] failed to rebuild BreezeTestDb`, mentioning truncation**
```
String or binary data would be truncated ... Truncated value: 'San CristÃƒÂ³ba'.
```
The database was built without `-f 65001` and the accented data is corrupted, compounding
on each rebuild. Drop it and recreate with the flag.

**`[db-reset] POST .../breeze/TestDb/Snapshot returned 404`** (or `.../Reset`)
The test server was started without `--TestDb:AllowReset=true`, or predates the endpoints.
Stop it and let the script start one, or start it as in
[section 2](#2-start-the-test-server).

**Inheritance tests fail on empty tables**
The database was recreated while the server was running. The server only seeds those
tables at startup — restart it, or `POST http://localhost:34377/breeze/Inheritance/Seed`.

**Browser mode fails every request with a CORS error**
The server predates the `BreezeTestCors` policy. Pull the latest `breeze-server-v3` and
rebuild.

**A tier printed nothing and exited 1**
Read `%TEMP%reeze-vitest-<tier>.log`: the script keeps every tier's full output there.
Vitest writes its warnings to stderr, and in Windows PowerShell a native command's stderr
arrives as an error record; under `$ErrorActionPreference = 'Stop'` that used to abort the
script mid-tier, which looked exactly like a failing tier. The script now merges stderr
into the log and lets the exit code decide.

**A test fails once and passes on re-run**
The file order is shuffled on every run, so check whether it depends on the order: re-run
with the seed printed at the top of the failing run (`--sequence.seed=<seed>`), then run
its file on its own. The database is reset before every file, so a test that fails only
after some other file depends on state that file left behind outside the database, or
on a row it never created — please fix it, or note it in `STATUS.md`.

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
The script prints the last lines of `%TEMP%\breeze-test-server.log`, and the cause is always
in there. Usually it is another program already using port 34377, a build error in
`breeze-server-v3`, or Windows application control blocking the server assembly — see the
last entry in this section.

**`No test in the integration tier matched -Filter '...'`**
Nothing matched the filter. It is matched against the full test name, including its
`describe` blocks, so check the spelling against the test file.

**`An Application Control policy has blocked this file`** (in the server log)
Windows application control — Smart App Control, or an organisation's WDAC policy — blocks
unsigned binaries, and a locally built one is always unsigned. The server dies on startup
with `0x800711C7`, and the script reports `The test server exited during startup`.

`UseAppHost=false` is set on both test hosts, so there is no per-project `.exe` for the
policy to block. **That is not a fix.** The policy also blocks `dotnet.exe` from loading the
managed assembly, which is where this actually fails. Confirm it:

```powershell
Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy |
  Select-Object VerifiedAndReputablePolicyState   # 0 = off, 1 = enforced, 2 = evaluation

Get-WinEvent -LogName Microsoft-Windows-CodeIntegrity/Operational -MaxEvents 20 |
  Where-Object Id -in 3076,3077
```

Event 3077 names both the blocked file and the policy that blocked it.

Nothing in either repo can work around this, and every rebuild re-triggers it, because each
build writes a new unsigned file. The fix is a decision about the machine:

- **Turn Smart App Control off.** Windows Security → App & browser control → Smart App
  Control settings → **Off**. It blocks unsigned binaries and every local build produces
  one, so it cannot coexist with .NET development on the same machine. Windows will not let
  it be turned back on afterwards without resetting the machine, so treat it as one-way. The
  registry check above should then read `0`.
- **Or run the server where the policy does not apply** — another machine, a VM, or WSL2,
  since Smart App Control does not govern Linux binaries. The host reads environment
  variables, so `ConnectionStrings__BreezeTestDb` can point a WSL2-side server at SQL Server
  on Windows with no source change; it needs a SQL login over TCP, because Windows
  integrated auth will not work from Linux.
- Signing the assemblies is not a practical answer: Smart App Control goes on reputation,
  not merely on a valid signature.

`npm run test:unit` needs no server and is unaffected by any of this.

**`(!) Your Vite config uses features that are unsupported by configLoader: 'native'`**
Harmless. Every run prints it; it concerns a future Vite default, not the tests.

---

## Building the docs

Separate from the tests; see [DOCS.md](./DOCS.md). In short: `npm run docs:dev`, then open
http://localhost:5173/ and click **API**.
