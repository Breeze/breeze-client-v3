#!/usr/bin/env node
// Generate - or update in place - one TypeScript class per structural type in a Breeze
// metadata document.
//
//   npx breeze-gen-entities --out src/app/model \
//     --service http://localhost:34377/breeze/NorthwindIBModel
//
// That is the spelling for an application: the script is published inside breeze-client,
// wired up as the `breeze-gen-entities` bin, so `npm i breeze-client` is the whole install.
// Inside this repo it is also `node scripts/generate-entity-classes.js ...`, and
// `npm run gen:model` is that with the arguments filled in.
//
// --out and a metadata source are required; nothing can infer either. Everything else has a
// default - the files import from 'breeze-client', which is right wherever the package is
// installed. Paths are relative to where the command is run, not to where the script lives.
//
// It reads the metadata through the library itself, so naming conventions, `nameOnServer`,
// inheritance and complex types resolve exactly as they do at runtime. See loadBreeze for
// which copy of Breeze that is.
//
// Updating is per member, not per file, and THE METADATA DECIDES WHAT THE GENERATOR OWNS - not
// the `// @generated` marker:
//
//   - A declared property whose name is in the metadata is a mapped property of the type. It is
//     rewritten to `declare <name>: <type>;  // @generated`, whether or not it was marked.
//   - A metadata property the file does not declare is appended.
//   - A declared property the metadata does NOT have is the caller's and stays - unless it is
//     marked, which means the generator wrote it and the column has left the schema, so it goes.
//     That one decision is the only thing the marker still drives.
//   - The class declaration is made to extend the base the generator means it to, and members
//     that base supplies are not left redeclared.
//   - Imports are added when a generated member needs one, and removed only when marked and
//     unreferenced.
//   - Methods, getters, constructors, unmapped properties, comments and hand-written imports
//     survive untouched.
//
// Ownership by metadata is what lets a hand-written class be taken over a property at a time
// rather than having its whole body appended a second time. Because that rewrites lines somebody
// typed, a file with no `@generated-by` header is reported and skipped unless --adopt is passed.
//
// To keep something out of all of this, see MANUAL_MARK below: `// @manual` on one declaration,
// `// @manual-start` / `// @manual-end` around a block, `// @manual-file` for a whole file.
//
// Every generated file carries the generator version in its header, so a later version can tell
// what produced what. See test/model/README.md.
//
// --- why this is JavaScript, in a TypeScript repository ---------------------------------------
//
// So that it runs unbuilt, from wherever it happens to be. Two copies exist and both have to
// work the moment they are invoked: scripts/generate-entity-classes.js in this repo, and
// node_modules/breeze-client/generate-entity-classes.js after an install, which prepare-dist.mjs
// copies into dist/ and package.json declares as the `breeze-gen-entities` bin. Node runs this
// file directly in both places. tsconfig.json is `include: ["src/**/*.ts"]`, so scripts/ is
// outside the build graph entirely, and nothing about the tool can be stale against its source.
//
// It could be TypeScript - tsc already runs, and emitting it into dist/ next to breeze.js would
// work. The cost is a coupling that points the wrong way: the generator would not run until the
// library had been compiled, and its whole job is to run *before* an application has any model
// code to compile. It would also put a build step between an edit to this file and testing it,
// for a script whose only consumer is node.
//
// What that gives up is type checking, and the mitigation is test/unit/entity-generator.spec.ts,
// which runs the real script against real metadata in a temp directory and asserts on the files
// that come out - closer to what actually matters here than types on the string handling would be.
//
// The one place types would genuinely help is the Breeze metadata objects this reads through
// loadBreeze (EntityType, DataProperty, NavigationProperty). Those are `any` today. If that
// starts causing mistakes rather than just costing autocomplete, revisit it - a JSDoc
// `@type {import('../src/breeze').EntityType}` buys most of it with no build step, and
// `checkJs` would enforce it.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATOR_VERSION = '1.0.0';
const GENERATOR_NAME = 'generate-entity-classes';

/** Where the script itself lives: node_modules/breeze-client/ when installed, scripts/ here. */
const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * What --out and --metadata are relative to. The caller's directory, never the script's: an
 * installed generator sits in node_modules, and resolving --out against that would write the
 * application's model into its own dependency. `npm run` sets cwd to the package root, so
 * `npm run gen:model` is unaffected.
 */
const workingDir = process.cwd();

/** The marker that says "this line is mine". */
const MARK = '// @generated';

/**
 * The opt-out, at three scopes. Anything they cover is never rewritten, removed or re-pointed,
 * whatever the metadata says, and nothing is inserted inside a region.
 *
 *   // @manual          on one declaration - that property is yours
 *   // @manual-start    ... // @manual-end   - everything between them is yours
 *   // @manual-file     anywhere in the file - the whole file is yours
 *
 * They exist because the metadata - not the `@generated` marker - decides what the generator
 * owns. A property whose name is in the metadata is the generator's, marked or not, which is what
 * lets a hand-written class be adopted without editing every line of it first. That leaves no way
 * to say "this one is mine" by deleting a marker, so it is said explicitly instead.
 */
const MANUAL_MARK = '// @manual';
const MANUAL_FILE_MARK = '// @manual-file';
const MANUAL_START_MARK = '// @manual-start';
const MANUAL_END_MARK = '// @manual-end';

// --- options ---------------------------------------------------------------------------------

// Required: --out, and one of --metadata / --service. Neither is guessable, and guessing wrong
// at --out overwrites a directory the caller did not mean to name.
const DEFAULTS = {
  metadata: null,
  service: null,
  out: null,
  // The module the generated files import Breeze types from. The published package name is
  // right for everyone who installs breeze-client, including this repo - test/tsconfig.json
  // maps it to the sources with `paths`, and vitest.shared.config.ts with an alias. Override
  // it only for a fork republished under another name.
  breeze: 'breeze-client',
  // Extension for sibling imports. '' suits a bundler (Vite, the test tier); '.js' suits a
  // NodeNext project.
  ext: '',
  // A base class of the caller's own for every generated root type, and the module to import it
  // from. Null means the EntityBase / ComplexObjectBase in the generated entity-base.ts.
  base: null,
  baseModule: null,
  complexBase: null,
  complexBaseModule: null,
  nullable: false,
  types: null,
  index: true,
  dryRun: false,
  // Whether to take over a file the generator has never written - one with no `@generated-by`
  // header. Claiming members in somebody's hand-written class is a one-way door with no undo but
  // git, so a plain run reports what it would do and writes nothing.
  adopt: false,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--metadata': opts.metadata = next(); opts.service = null; break;
      case '--service': opts.service = next(); opts.metadata = null; break;
      case '--out': opts.out = next(); break;
      case '--breeze': opts.breeze = next(); break;
      case '--ext': opts.ext = next(); break;
      case '--base': opts.base = next(); break;
      case '--base-module': opts.baseModule = next(); break;
      case '--complex-base': opts.complexBase = next(); break;
      case '--complex-base-module': opts.complexBaseModule = next(); break;
      case '--types': opts.types = next().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--nullable': opts.nullable = true; break;
      case '--no-index': opts.index = false; break;
      case '--adopt': opts.adopt = true; break;
      case '--dry-run': case '-n': opts.dryRun = true; break;
      case '--version': console.log(GENERATOR_VERSION); process.exit(0);
      case '--help': case '-h': usage(); process.exit(0);
      default: fail(`unknown option ${arg}`);
    }
  }
  if (!opts.metadata && !opts.service) fail('one of --metadata <file> or --service <url> is required');
  if (!opts.out) fail('--out <dir> is required');
  return opts;
}

function usage() {
  console.log(`${GENERATOR_NAME} v${GENERATOR_VERSION} - TypeScript entity classes from Breeze metadata.

Required - one source of metadata:
  --metadata <file>   metadata JSON to read, relative to the current directory
  --service <url>     fetch <url>/Metadata from a running service instead

Required:
  --out <dir>         where the classes go, relative to the current directory

Optional:
  --ext <ext>         extension on sibling imports, e.g. .js for a NodeNext project
                      (default: none, which suits a bundler)

  --breeze <spec>     the module the generated files import Breeze types from
                      (default: breeze-client). Override it only for a fork republished
                      under another name. A relative specifier is written verbatim into
                      every generated file, so it must be correct relative to --out rather
                      than to where the command is run.

  --base <Name>       a base class of your own for every generated entity, so you can give them
                      all behaviour and still regenerate their properties. Only the root of an
                      inheritance chain extends it; a type with a metadata base type extends
                      that, as before.

                      It is scaffolded once, extending the generated EntityBase, and then never
                      rewritten - nothing in it is marked @generated:

                        // --base AppEntityBase  ->  app-entity-base.ts
                        export abstract class AppEntityBase extends EntityBase {
                          get isNew() { return this.entityAspect.entityState.isAdded(); }
                        }

  --base-module <spec>      where to import it from
                            (default: ./<kebab-name>, alongside the generated classes)
  --complex-base <Name>     the same, for complex types; extends ComplexObjectBase
  --complex-base-module <spec>

  --types <A,B>       only these short names
  --nullable          add "| null" to nullable data properties
  --no-index          do not write index.ts

  --adopt             take over hand-written classes - files with no @generated-by header.
                      The metadata decides what is a mapped property, so those are rewritten
                      into the generated form and the class is made to extend the base;
                      methods, getters, constructors and everything else are left alone.
                      Without it such a file is reported and skipped. Pair with --dry-run
                      the first time.

                      To keep code away from the generator for good:
                        // @manual        on one declaration
                        // @manual-start  ... // @manual-end   around a block
                        // @manual-file   anywhere in a file - it is never opened
  --dry-run, -n       report what would change, write nothing
  --version           print the generator version
  --help, -h          this list

Examples:
  npx breeze-gen-entities \\
    --service http://localhost:34377/breeze/NorthwindIBModel \\
    --out src/app/model

  node scripts/generate-entity-classes.js \\
    --metadata test/support/NorthwindIBMetadata_ETNOPAYLOAD.json \\
    --out test/model`);
}

function fail(msg) {
  console.error(`${GENERATOR_NAME}: ${msg}`);
  process.exit(1);
}

// --- metadata --------------------------------------------------------------------------------

/**
 * The copy of Breeze the metadata is read through - and it has to be the caller's own.
 * Metadata parsing is Breeze's: naming conventions, `nameOnServer`, inheritance and complex
 * types all resolve here exactly as they will at runtime, so a generator reading a different
 * version would emit classes that disagree with the library the application runs.
 *
 * Installed, the script's sibling IS that copy: npx runs node_modules/breeze-client/
 * generate-entity-classes.js, and breeze.js sits beside it in the same package. In this repo
 * the script is in scripts/ and the build output is ../dist/.
 */
async function loadBreeze() {
  const candidates = [
    join(scriptDir, 'breeze.js'),                 // installed: dist/ is the package root
    join(scriptDir, '..', 'dist', 'breeze.js'),   // this repo, after `npm run build`
  ];
  const found = candidates.find(existsSync);
  if (!found) {
    fail(`breeze.js not found - looked in:\n`
      + candidates.map(c => `    ${c}`).join('\n')
      + '\n  In the breeze-client repo, run `npm run build` first.');
  }
  return import(`file://${found}`);
}

async function loadMetadata(opts) {
  if (opts.service) {
    const url = opts.service.replace(/\/$/, '') + '/Metadata';
    const response = await fetch(url);
    if (!response.ok) fail(`${url} returned ${response.status} ${response.statusText}`);
    return await response.text();
  }
  const path = resolve(workingDir, opts.metadata);
  if (!existsSync(path)) fail(`metadata file not found: ${path}`);
  return readFileSync(path, 'utf8');
}

// --- names and types -------------------------------------------------------------------------

/** 'OrderDetail' -> 'order-detail', matching the file naming everywhere else in the repo. */
function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** 'Order:#Foo' -> 'Order' */
function shortNameOf(qualifiedName) {
  return String(qualifiedName).split(':#')[0];
}

// What each Breeze DataType looks like once it reaches the client.
const TS_TYPE_BY_DATA_TYPE = {
  String: 'string',
  Guid: 'string',
  Boolean: 'boolean',
  Byte: 'number',
  Int16: 'number',
  Int32: 'number',
  Int64: 'number',
  Decimal: 'number',
  Double: 'number',
  Single: 'number',
  DateTime: 'Date',
  DateTimeOffset: 'Date',
  DateOnly: 'Date',
  // A .NET TimeSpan, as an ISO 8601 duration: "PT1H30M".
  Time: 'string',
  // A .NET TimeOnly, as the server writes it: "14:30:00".
  TimeOnly: 'string',
  // A byte[], base64 encoded.
  Binary: 'string',
  Undefined: 'any',
};

/** The TS type for one member, recording the imports it needs in `needs`. */
function memberType(prop, isNavigation, opts, needs) {
  if (isNavigation) {
    const target = shortNameOf(prop.entityTypeName);
    needs.siblings.add(target);
    if (prop.isScalar) return target;
    needs.breeze.add('RelationArray');
    return `RelationArray<${target}>`;
  }
  if (prop.isComplexProperty) {
    const target = shortNameOf(prop.complexTypeName);
    needs.siblings.add(target);
    if (prop.isScalar === false) {
      needs.breeze.add('ComplexArray');
      return `ComplexArray<${target}>`;
    }
    return target;
  }
  const dataTypeName = prop.dataType && prop.dataType.name;
  const tsType = TS_TYPE_BY_DATA_TYPE[dataTypeName];
  if (!tsType) {
    console.warn(`  ! ${prop.parentType.shortName}.${prop.name}: unmapped DataType '${dataTypeName}', using any`);
    return 'any';
  }
  if (!prop.isScalar) return `${tsType}[]`;
  if (opts.nullable && prop.isNullable && tsType !== 'any') return `${tsType} | null`;
  return tsType;
}

/**
 * The members to write for one structural type: its own data properties, then its own navigation
 * properties, in metadata order. Properties inherited from a base type are left to the base
 * class, which the generated class extends.
 */
function membersOf(stype, opts, needs) {
  const members = [];
  for (const dp of stype.dataProperties) {
    if (dp.baseProperty) continue;      // declared by the base class
    if (dp.isUnmapped) continue;        // comes from a client-side class, not from the server
    members.push({ name: dp.name, type: memberType(dp, false, opts, needs) });
  }
  for (const np of stype.navigationProperties || []) {
    if (np.baseProperty) continue;
    members.push({ name: np.name, type: memberType(np, true, opts, needs) });
  }
  return members;
}

// --- reading an existing file ------------------------------------------------------------------

/**
 * Blank out string, template and comment spans so that a brace scan cannot be fooled by one.
 * Only used for locating things; the original text is what gets edited.
 */
function maskLiterals(source) {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const two = source.substr(i, 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') { out[i] = ' '; i++; }
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) if (source[i] !== '\n') out[i] = ' ';
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out[i] = ' '; i++;
      while (i < source.length) {
        if (source[i] === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
        if (source[i] === quote) { out[i] = ' '; i++; break; }
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
    } else {
      i++;
    }
  }
  return out.join('');
}

/** The 0-based [first, last] line range of the body of `class <name>`, excluding the braces. */
function findClassBodyLines(lines, className) {
  const masked = maskLiterals(lines.join('\n')).split('\n');
  const declLine = masked.findIndex(l => new RegExp(`\\bclass\\s+${className}\\b`).test(l));
  if (declLine === -1) return null;
  let depth = 0;
  let openLine = -1;
  for (let i = declLine; i < masked.length; i++) {
    for (const ch of masked[i]) {
      if (ch === '{') { if (depth === 0) openLine = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0) return { first: openLine + 1, last: i - 1 };
      }
    }
  }
  return null;
}

/**
 * One member declaration, capturing indent, name and trailing comment:
 * `declare customerID: string;` and the shapes a hand edit is likely to produce (modifiers, `?`,
 * `!`, a trailing comment). Deliberately single-line, and deliberately blind to methods, getters
 * and initialized fields - none of those is ever what this tool owns. A declaration wrapped
 * across lines is not matched either; it reads as "not declared", so the generator appends a
 * duplicate and tsc rejects it, rather than the edit going silently wrong.
 */
const ANY_DECLARATION_RE =
  /^([ \t]*)((?:(?:public|private|protected|readonly|declare|static|abstract)\s+)*)([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*([^;\n{]*);[ \t]*(\/\/.*)?$/;

/** [indent, modifiers, name, type] for a declaration line, or null. */
function parseDeclaration(line) {
  const m = ANY_DECLARATION_RE.exec(line);
  return m && { indent: m[1], modifiers: m[2], name: m[3], type: m[4] };
}

/**
 * Whether a line already says what the generator would write, ignoring how it is spaced.
 *
 * Formatters reach these files. Prettier collapses the two spaces before the marker to one and
 * flips quote style; it does not move or drop the trailing comment, even past 110 columns - both
 * checked. Comparing the rendered strings byte for byte would therefore see a difference on every
 * run and rewrite all of them back, so the generator and the formatter would each undo the other
 * forever. Comparing meaning instead means a formatted file is simply left alone.
 */
function isCanonical(line, member) {
  const d = parseDeclaration(line);
  if (!d || d.name !== member.name) return false;
  if (!/\bdeclare\b/.test(d.modifiers)) return false;   // missing `declare` is a real defect
  if (!isMarked(line)) return false;                    // must still say whose it is
  const squash = t => t.replace(/\s+/g, '');
  return squash(d.type) === squash(member.type);
}

function isMarked(line) {
  return /\/\/\s*@generated\b/.test(line);
}

/** `// @manual` on this line - and not `@manual-start`, `@manual-end` or `@manual-file`. */
function isManual(line) {
  return /\/\/\s*@manual(?![-\w])/.test(line);
}

// The region and file markers must stand alone on their own comment line - anchored, so that
// prose mentioning one does not become one. A file that merely talks about `// @manual-file`,
// this script included, is not opted out.
const MANUAL_FILE_RE = /^[ \t]*\/\/[ \t]*@manual-file\b/;
const MANUAL_START_RE = /^[ \t]*\/\/[ \t]*@manual-start\b/;
const MANUAL_END_RE = /^[ \t]*\/\/[ \t]*@manual-end\b/;

/** `// @manual-file` on a line of its own: the generator does not open the file at all. */
function isManualFile(lines) {
  return lines.some(l => MANUAL_FILE_RE.test(l));
}

/**
 * The line numbers inside `// @manual-start` / `// @manual-end`, the markers included.
 *
 * Recomputed wherever it is needed rather than cached, because every splice moves the lines
 * underneath it. An unclosed start runs to the end of the file, which is the safe reading: the
 * cost of a typo is that the generator declines to edit, never that it edits the wrong thing.
 */
function manualLines(lines) {
  const out = new Set();
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (MANUAL_START_RE.test(lines[i])) { if (open === -1) open = i; }
    else if (MANUAL_END_RE.test(lines[i]) && open !== -1) {
      for (let j = open; j <= i; j++) out.add(j);
      open = -1;
    }
  }
  if (open !== -1) for (let j = open; j < lines.length; j++) out.add(j);
  return out;
}

/** The first line at or after `at` that is not inside a manual region - where it is safe to insert. */
function pastManualRegion(lines, at) {
  const manual = manualLines(lines);
  let i = at;
  while (i < lines.length && manual.has(i)) i++;
  return i;
}

// --- the header ------------------------------------------------------------------------------

const HEADER_FIRST_RE = new RegExp(`^// @generated-by ${GENERATOR_NAME} v([\\w.\\-]+)`);

function renderHeader(scope) {
  return [
    `// @generated-by ${GENERATOR_NAME} v${GENERATOR_VERSION}`,
    ...(scope === 'whole'
      ? ['// This whole file is generated. Put hand-written code in a separate module.']
      : [
        '// Properties of this type in the server metadata are written here and rewritten on',
        '// every run. Everything else in this file is yours and is never touched.',
        '// To keep one of those too, see the manual markers in ./README.md.',
        //   ^ deliberately not spelled out. The markers are matched by scanning the file, so a
        //     header that named them would opt every generated file out of the generator.
      ]),
  ];
}

/** Whether this file is one the generator has written before. */
function hasGeneratedHeader(lines) {
  return lines.length > 0 && HEADER_FIRST_RE.test(lines[0]);
}

/**
 * Say what --adopt would do to a hand-written file, and write nothing. The counts are the point:
 * they tell you how much of the class the generator would take over before it does it.
 */
function reportAdoptable(fileName, className, members) {
  console.log(`  skip ${fileName}  - no ${GENERATOR_NAME} header, so it is not the generator's`);
  console.log(`         ${members.length} propert${members.length === 1 ? 'y' : 'ies'} in the metadata for ${className}`);
  console.log(`         --adopt takes it over; --adopt --dry-run shows what that would change`);
}

/** Replace the leading `// @generated-by ...` comment block, or prepend one. Returns [lines, was]. */
function applyHeader(lines, scope) {
  const header = renderHeader(scope);
  if (lines.length && HEADER_FIRST_RE.test(lines[0])) {
    const wasVersion = HEADER_FIRST_RE.exec(lines[0])[1];
    let end = 1;
    while (end < lines.length && /^\/\//.test(lines[end])) end++;
    return [[...header, ...lines.slice(end)], wasVersion];
  }
  return [[...header, ...lines], null];
}

// --- imports ---------------------------------------------------------------------------------

const IMPORT_RE =
  /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+(['"])([^'"]+)\3;?[ \t]*(\/\/.*)?$/;

/** What the generated members of one type need to import. */
function requiredImports(needs, opts, selfName) {
  const required = [];
  if (needs.breeze.size) {
    required.push({
      specifier: opts.breeze,
      names: [...needs.breeze].sort(),
      typeOnly: true,
    });
  }
  // The base class is extended, so it is a value import.
  required.push({ specifier: needs.baseModule, names: [needs.base], typeOnly: false });

  for (const sibling of [...needs.siblings].sort()) {
    if (sibling === selfName) continue;         // a self-reference needs no import
    if (sibling === needs.base) continue;       // already imported as a value, above
    required.push({ specifier: `./${kebab(sibling)}${opts.ext}`, names: [sibling], typeOnly: true });
  }
  return required;
}

/**
 * Make sure every required import is present, without removing anything the file added.
 * Marked import lines lose names that are neither required nor referenced anywhere else.
 */
function reconcileImports(lines, required, notes) {
  const manual = manualLines(lines);
  const statements = [];
  lines.forEach((line, i) => {
    const m = IMPORT_RE.exec(line);
    if (m) {
      statements.push({
        line: i,
        typeOnly: !!m[1],
        names: m[2].split(',').map(s => s.trim()).filter(Boolean),
        specifier: m[4],
        marked: isMarked(line),
        // Protected even when marked `@generated`: a region wins over ownership. The names
        // still count as bound below, so nothing re-imports them.
        manual: isManual(line) || manual.has(i),
      });
    }
  });

  const requiredSpecifierOf = new Map();
  for (const req of required) {
    for (const name of req.names) requiredSpecifierOf.set(name, req.specifier);
  }

  // 0. Re-point a marked import whose module has moved - --breeze changed, say, or the classes
  //    were regenerated into a different directory. Dropping the name here lets the add step
  //    put it back at the right specifier; without this it looks satisfied and the stale module
  //    survives. Marked statements only: a hand-written import of the same name is the caller's.
  for (const stmt of statements) {
    if (!stmt.marked || stmt.manual) continue;
    const moved = stmt.names.filter(n => {
      const local = n.split(/\s+as\s+/).pop().trim();
      return requiredSpecifierOf.has(local) && requiredSpecifierOf.get(local) !== stmt.specifier;
    });
    if (!moved.length) continue;
    const to = requiredSpecifierOf.get(moved[0].split(/\s+as\s+/).pop().trim());
    notes.push(`move ${moved.join(', ')} from '${stmt.specifier}' to '${to}'`);
    stmt.names = stmt.names.filter(n => !moved.includes(n));
    lines[stmt.line] = stmt.names.length ? renderImport(stmt) : null;
  }

  const bound = new Set(statements.flatMap(s => s.names.map(n => n.split(/\s+as\s+/).pop().trim())));
  const requiredBySpecifier = new Map();
  for (const req of required) {
    const key = `${req.specifier}\u0000${req.typeOnly}`;
    const names = requiredBySpecifier.get(key) || [];
    requiredBySpecifier.set(key, names.concat(req.names));
  }

  // 1. Add what is missing.
  const additions = [];
  for (const [key, names] of requiredBySpecifier) {
    const [specifier, typeOnlyStr] = key.split('\u0000');
    const typeOnly = typeOnlyStr === 'true';
    const missing = names.filter(n => !bound.has(n));
    if (!missing.length) continue;

    const host = statements.find(s => s.specifier === specifier && s.typeOnly === typeOnly);
    if (host) {
      host.names = [...new Set([...host.names, ...missing])];
      lines[host.line] = renderImport(host);
      notes.push(`import ${missing.join(', ')} from '${specifier}'`);
    } else {
      additions.push({ specifier, typeOnly, names: missing, marked: true });
      notes.push(`import ${missing.join(', ')} from '${specifier}'`);
    }
    missing.forEach(n => bound.add(n));
  }

  // 2. Prune marked imports that nothing needs any more.
  const requiredNames = new Set(required.flatMap(r => r.names));
  const bodyText = lines.filter(l => l !== null && !IMPORT_RE.test(l)).join('\n');
  for (const stmt of statements) {
    if (!stmt.marked || stmt.manual) continue;
    const keep = stmt.names.filter(n => {
      const local = n.split(/\s+as\s+/).pop().trim();
      if (requiredNames.has(local)) return true;
      return new RegExp(`\\b${local}\\b`).test(bodyText);   // still used by hand-written code
    });
    if (keep.length === stmt.names.length) continue;
    const dropped = stmt.names.filter(n => !keep.includes(n));
    notes.push(`drop import ${dropped.join(', ')} from '${stmt.specifier}'`);
    stmt.names = keep;
    lines[stmt.line] = keep.length ? renderImport(stmt) : null;
  }
  // An import statement left with no names - here or in step 0 - is dropped outright. Nulling
  // and filtering once keeps every `stmt.line` index valid until all the passes are done.
  lines = lines.filter(l => l !== null);

  // 3. Insert the new statements after the last import, or after the header - and never inside
  //    a manual region, which is why each insertion point is pushed past one.
  if (additions.length) {
    let at = -1;
    for (let i = 0; i < lines.length; i++) if (IMPORT_RE.test(lines[i])) at = i;
    if (at === -1) {
      at = 0;
      while (at < lines.length && /^\/\//.test(lines[at])) at++;
      at = pastManualRegion(lines, at);
      lines.splice(at, 0, '');
      at++;
      lines.splice(at, 0, ...additions.map(renderImport));
      return lines;
    }
    at = pastManualRegion(lines, at + 1) - 1;
    lines.splice(at + 1, 0, ...additions.map(renderImport));
  }
  return lines;
}

function renderImport(stmt) {
  const kind = stmt.typeOnly ? 'import type' : 'import';
  const suffix = stmt.marked ? ` ${MARK}` : '';
  return `${kind} { ${stmt.names.join(', ')} } from '${stmt.specifier}';${suffix}`;
}

// --- properties ------------------------------------------------------------------------------

function renderProperty(member, indent) {
  return `${indent}declare ${member.name}: ${member.type};  ${MARK}`;
}

/**
 * Bring the class body's mapped properties into line with `members`, leaving every other member,
 * comment and blank line where it is.
 *
 * **The metadata decides what the generator owns, not the marker.** A declared property whose
 * name is in `members` is a mapped property of this type and is rewritten to the canonical form;
 * a declared property that is not is the caller's and is never touched. That is what lets a
 * hand-written class - which has no markers anywhere - be adopted a property at a time instead of
 * having its whole class body appended a second time.
 *
 * The marker is still written, and is still read for exactly one decision: a declaration the
 * metadata no longer has can be removed only if the generator is the one that put it there. An
 * unmarked property absent from the metadata is a hand-written member and stays.
 *
 * `// @manual` is the way out: it pins a declaration against all of this.
 */
function reconcileProperties(lines, className, members, notes) {
  const body = findClassBodyLines(lines, className);
  if (!body) fail(`could not find "class ${className}"`);

  // Index what the class body already declares. `manual` covers both scopes that can protect a
  // single line: the marker on it, and a region enclosing it.
  const manual = manualLines(lines);
  const declared = new Map();   // name -> { line, indent, marked, manual }
  for (let i = body.first; i <= body.last; i++) {
    const d = parseDeclaration(lines[i]);
    if (d) {
      declared.set(d.name, {
        line: i, indent: d.indent, marked: isMarked(lines[i]),
        manual: isManual(lines[i]) || manual.has(i),
      });
    }
  }

  const wanted = new Map(members.map(m => [m.name, m]));
  const indent = [...declared.values()].find(d => d.marked)?.indent
    ?? [...declared.values()][0]?.indent
    ?? '  ';

  // 1. Rewrite what is already there, marked or not - the metadata says it is ours.
  const appended = [];
  for (const member of members) {
    const existing = declared.get(member.name);
    if (!existing) { appended.push(member); continue; }
    if (existing.manual) {
      notes.push(`${member.name} is yours (${MANUAL_MARK}) - left as it is`);
      continue;
    }
    // Already says the right thing, however it is spaced - leave the line exactly as it is, so a
    // formatter's pass over the file does not become a change for the generator to undo.
    if (isCanonical(lines[existing.line], member)) continue;
    const next = renderProperty(member, existing.indent);
    if (lines[existing.line] !== next) {
      // Worth distinguishing in the log: the first is routine, the second takes over a line
      // somebody wrote by hand.
      notes.push(existing.marked
        ? `${member.name}: ${member.type}`
        : `adopt ${member.name}: ${member.type}`);
      lines[existing.line] = next;
    }
  }

  // 2. Drop properties the metadata no longer has - but only ones the generator wrote. This is
  //    the single decision the marker still drives: without it, a hand-written member would be
  //    indistinguishable from a column that has left the schema.
  const stale = [...declared.entries()]
    .filter(([name, d]) => d.marked && !d.manual && !wanted.has(name))
    .map(([name, d]) => ({ name, line: d.line }));
  for (const { name, line } of stale.sort((a, b) => b.line - a.line)) {
    notes.push(`remove ${name} - no longer in the metadata`);
    lines.splice(line, 1);
  }

  // 3. Append what is new, after the last mapped property, else at the top of the body.
  //
  //    "Mapped" rather than "marked": step 1 has just marked the ones it adopted, so in a file
  //    being taken over this lands the new properties with the existing ones instead of above
  //    everything - which is where they went when nothing in the class carried a marker.
  if (appended.length) {
    const after = findClassBodyLines(lines, className);
    let at = after.first;
    for (let i = after.first; i <= after.last; i++) {
      const d = parseDeclaration(lines[i]);
      if (d && (isMarked(lines[i]) || wanted.has(d.name))) at = i + 1;
    }
    at = pastManualRegion(lines, at);   // never insert into somebody else's block
    for (const member of appended) notes.push(`add ${member.name}: ${member.type}`);
    lines.splice(at, 0, ...appended.map(m => renderProperty(m, indent)));
  }
  return lines;
}

/** The members EntityBase / ComplexObjectBase supply, which a class extending one must not redeclare. */
const SUPPLIED_MEMBERS = {
  entity: ['entityAspect', 'entityType', 'getProperty', 'setProperty'],
  complex: ['complexAspect', 'complexType', 'getProperty', 'setProperty'],
};

const CLASS_DECL_RE = /^(\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*))([^{]*)\{(.*)$/;

/**
 * Make the class extend the base the generator means it to, and stop it redeclaring what that
 * base supplies.
 *
 * Two cases reach here. A hand-written class adopted for the first time typically reads
 * `class Customer implements Entity` and declares `entityAspect`, `entityType`, `getProperty` and
 * `setProperty` itself; extending EntityBase is what makes those - and the generated import of it
 * - mean anything. The second is an existing generated class after `--base` changed, which used
 * to import the new base and go on extending the old one.
 *
 * Only the heritage clause is rewritten. An `implements` of the caller's own is kept, because it
 * says something the generator does not know; `implements Entity` / `implements ComplexObject` is
 * dropped, because the base already implements it.
 */
function reconcileClassDeclaration(lines, className, needs, isComplexType, notes) {
  const at = lines.findIndex(l => CLASS_DECL_RE.test(l) && CLASS_DECL_RE.exec(l)[2] === className);
  if (at === -1) return lines;
  if (isManual(lines[at]) || manualLines(lines).has(at)) return lines;

  const [, head, , heritage, tail] = CLASS_DECL_RE.exec(lines[at]);
  const currentExtends = /\bextends\s+([A-Za-z_$][\w$]*)/.exec(heritage);
  if (currentExtends && currentExtends[1] === needs.base) return lines;

  const supplied = SUPPLIED_MEMBERS[isComplexType ? 'complex' : 'entity'];
  const breezeInterface = isComplexType ? 'ComplexObject' : 'Entity';
  const implemented = (/\bimplements\s+([^{]*)$/.exec(heritage)?.[1] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .filter(name => name !== breezeInterface);

  lines[at] = `${head} extends ${needs.base}`
    + (implemented.length ? ` implements ${implemented.join(', ')}` : '')
    + ` {${tail}`;
  notes.push(currentExtends
    ? `extends ${needs.base} - was ${currentExtends[1]}`
    : `extends ${needs.base}`);

  // Redeclaring what the base supplies shadows it. Without `declare` it is worse than redundant:
  // an ES2022 class field becomes a real own property set to undefined, hiding the accessors
  // Breeze installs on the prototype. See docs/guide/extending-entities.md.
  const body = findClassBodyLines(lines, className);
  if (!body) return lines;
  const manual = manualLines(lines);
  const dropped = [];
  for (let i = body.last; i >= body.first; i--) {
    const d = parseDeclaration(lines[i]);
    if (d && supplied.includes(d.name) && !isManual(lines[i]) && !manual.has(i)) {
      dropped.unshift(d.name);
      lines.splice(i, 1);
    }
  }
  if (dropped.length) {
    notes.push(`remove ${dropped.join(', ')} - supplied by ${needs.base}`);
    // Whatever imported those types is the caller's, and hand-written imports are never removed.
    // Say so rather than leaving a dead import to be discovered by `noUnusedLocals`.
    const stillUsed = lines.filter(l => !IMPORT_RE.test(l)).join('\n');
    const orphaned = lines
      .map(l => IMPORT_RE.exec(l))
      .filter(m => m && !isMarked(m[0]))
      .flatMap(m => m[2].split(',').map(s => s.split(/\s+as\s+/).pop().trim()))
      .filter(n => n && !new RegExp(`\\b${n}\\b`).test(stillUsed));
    if (orphaned.length) {
      notes.push(`${orphaned.join(', ')} may now be unused - imported by hand, so left in place`);
    }
  }
  return lines;
}

// --- rendering a new file ----------------------------------------------------------------------

function renderNewFile(stype, members, needs, opts, isComplexType) {
  const kind = isComplexType ? 'complex type' : 'entity type';
  const keys = (stype.keyProperties || []).map(p => p.name).join(', ');

  const imports = requiredImports(needs, opts, stype.shortName)
    .map(r => renderImport({ ...r, marked: true }));

  const doc = [
    '/**',
    ` * ${stype.name} - the ${kind}${stype.defaultResourceName ? `, queried as \`${stype.defaultResourceName}\`` : ''}.`,
  ];
  if (keys) doc.push(` * Key: ${keys}.`);
  doc.push(
    ' *',
    ' * Methods, getters and unmapped properties added below survive a regeneration; see',
    ' * ./README.md.',
    ' */'
  );

  return [
    ...renderHeader('members'),
    '',
    ...imports,
    '',
    ...doc,
    `export class ${stype.shortName} extends ${needs.base} {`,
    ...members.map(m => renderProperty(m, '  ')),
    '}',
    '',
  ].join('\n');
}

// --- the shared base classes and the barrel ----------------------------------------------------

/**
 * The class every generated type at the root of its inheritance chain extends, and the module to
 * import it from. `--base` / `--complex-base` name one of the caller's own, so that behaviour can
 * be added to every entity without giving up code generation; without them it is the
 * `EntityBase` / `ComplexObjectBase` in the generated entity-base.ts.
 */
function rootBase(opts, isComplexType) {
  const custom = isComplexType ? opts.complexBase : opts.base;
  const customModule = isComplexType ? opts.complexBaseModule : opts.baseModule;
  if (!custom) {
    return {
      name: isComplexType ? 'ComplexObjectBase' : 'EntityBase',
      module: `./entity-base${opts.ext}`,
      file: 'entity-base.ts',
      isCustom: false,
      isRelative: true,
      isComplexType,
    };
  }
  const module = customModule || `./${kebab(custom)}${opts.ext}`;
  // `file` is set only for a plain neighbour of the generated classes - the one case where the
  // generator knows exactly where to scaffold it.
  let file = null;
  if (module.startsWith('./') && !module.slice(2).includes('/')) {
    const stem = module.slice(2);
    file = (opts.ext && stem.endsWith(opts.ext) ? stem.slice(0, -opts.ext.length) : stem) + '.ts';
  }
  return { name: custom, module, file, isCustom: true, isRelative: module.startsWith('.'), isComplexType };
}

/** A starter for a custom base class, written once if it is not there. Never rewritten. */
function renderCustomBase(root, opts) {
  const supplied = root.isComplexType ? 'ComplexObjectBase' : 'EntityBase';
  const kind = root.isComplexType ? 'complex object' : 'entity';
  return [
    `// ${root.name} - the base class every generated ${kind} extends.`,
    '//',
    `// ${GENERATOR_NAME} wrote this file once because --${root.isComplexType ? 'complex-base' : 'base'} named a class it`,
    '// could not find. It is yours from here on: nothing in it is marked `@generated` and the',
    '// generator will never rewrite it. Put behaviour every generated class should have here.',
    '//',
    `// Anything added with an initializer becomes an unmapped property on every ${kind}; write`,
    '// methods and getters instead unless that is what you want. See',
    '// docs/guide/extending-entities.md.',
    `import { ${supplied} } from './entity-base${opts.ext}';`,
    '',
    `export abstract class ${root.name} extends ${supplied} {`,
    '}',
    '',
  ].join('\n');
}

function renderEntityBase(opts) {
  return [
    ...renderHeader('whole'),
    '//',
    '// The members Breeze itself supplies. Every generated class extends one of these.',
    '//',
    '// Each one is `declare`: with ES2022 class fields a plain field would become a real own',
    '// property set to undefined, hiding the accessors Breeze installs on the prototype. See',
    '// docs/guide/extending-entities.md, "Class fields and declare".',
    `import type { ComplexAspect, ComplexObject, ComplexType, Entity, EntityAspect, EntityType } from '${opts.breeze}';`,
    '',
    'export abstract class EntityBase implements Entity {',
    '  declare entityAspect: EntityAspect;',
    '  declare entityType: EntityType;',
    '  declare getProperty: (prop: string) => any;',
    '  declare setProperty: (prop: any, value: any) => any;',
    '}',
    '',
    'export abstract class ComplexObjectBase implements ComplexObject {',
    '  declare complexAspect: ComplexAspect;',
    '  declare complexType: ComplexType;',
    '  declare getProperty: (prop: string) => any;',
    '  declare setProperty: (prop: any, value: any) => any;',
    '}',
    '',
  ].join('\n');
}

function renderIndex(generated, opts) {
  const sorted = [...generated].sort((a, b) => a.shortName.localeCompare(b.shortName));
  const lines = [
    ...renderHeader('whole'),
    '//',
    '// registerModelClasses attaches these classes to one MetadataStore. Breeze binds a class to a',
    '// single store - registering the same class in a second store throws - so call it once, on the',
    '// store the managers under test share.',
    `import type { MetadataStore } from '${opts.breeze}';`,
    `export { ComplexObjectBase, EntityBase } from './entity-base${opts.ext}';`,
  ];
  // A custom base class lives alongside the classes, so the barrel should reach it too.
  for (const root of [rootBase(opts, false), rootBase(opts, true)]) {
    if (root.isCustom && root.isRelative) {
      lines.push(`export { ${root.name} } from '${root.module}';`);
    }
  }
  for (const g of sorted) {
    lines.push(`import { ${g.shortName} } from './${kebab(g.shortName)}${opts.ext}';`);
  }
  lines.push(
    '',
    'export {',
    ...sorted.map(g => `  ${g.shortName},`),
    '};',
    '',
    '/** Every generated class, by the short name Breeze knows it as. */',
    'export const modelClasses = {',
    ...sorted.map(g => `  ${g.shortName},`),
    '};',
    '',
    '/** Register all of them with `metadataStore`. Safe to call twice with the same store. */',
    'export function registerModelClasses(metadataStore: MetadataStore) {',
    '  for (const [name, ctor] of Object.entries(modelClasses)) {',
    '    metadataStore.registerEntityTypeCtor(name, ctor);',
    '  }',
    '}',
    ''
  );
  return lines.join('\n');
}

// --- main --------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const breeze = await loadBreeze();
  const metadata = await loadMetadata(opts);

  const metadataStore = new breeze.MetadataStore();
  metadataStore.importMetadata(metadata);

  let stypes = metadataStore.getEntityTypes();
  if (opts.types) {
    const wanted = new Set(opts.types);
    const missing = [...wanted].filter(n => !stypes.some(t => t.shortName === n));
    if (missing.length) fail(`not in the metadata: ${missing.join(', ')}`);
    stypes = stypes.filter(t => wanted.has(t.shortName));
  }
  if (!stypes.length) fail('the metadata contains no structural types');

  const outDir = resolve(workingDir, opts.out);
  if (!opts.dryRun) mkdirSync(outDir, { recursive: true });

  console.log(`${GENERATOR_NAME} v${GENERATOR_VERSION}`);
  console.log(`${stypes.length} types from ${opts.service || opts.metadata} -> ${opts.out}`);

  let changed = 0;
  const generated = [];

  const write = (name, contents, notes = []) => {
    const path = join(outDir, name);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    // Everything above renders with \n. Match what the file already uses instead, so a CRLF
    // checkout is not rewritten to LF on every run - which would also defeat the comparison
    // below and report every file as edited each time. A new file is left as \n; git applies
    // whatever the clone's core.autocrlf says.
    if (before !== null && before.includes('\r\n')) contents = contents.replace(/\r?\n/g, '\r\n');
    if (before === contents) return;
    changed++;
    console.log(`  ${before === null ? 'new ' : 'edit'} ${name}`);
    for (const note of notes) console.log(`         ${note}`);
    if (!opts.dryRun) writeFileSync(path, contents, 'utf8');
  };

  write('entity-base.ts', renderEntityBase(opts));

  // A custom base class is the caller's file, so it is scaffolded once and then left alone.
  for (const root of [rootBase(opts, false), rootBase(opts, true)]) {
    if (!root.isCustom || !root.file) continue;
    if (existsSync(join(outDir, root.file))) continue;
    console.log(`  new  ${root.file}  (yours from here on - the generator never rewrites it)`);
    if (!opts.dryRun) {
      writeFileSync(join(outDir, root.file), renderCustomBase(root, opts), 'utf8');
    }
    changed++;
  }

  for (const stype of stypes) {
    const isComplexType = stype instanceof breeze.ComplexType;
    const root = rootBase(opts, isComplexType);
    const needs = {
      breeze: new Set(),
      siblings: new Set(),
      base: root.name,
      baseModule: root.module,
    };
    const members = membersOf(stype, opts, needs);

    // An inheritance chain in the metadata becomes one in the generated classes; only the root
    // of each chain extends the base class.
    const baseType = stype.baseEntityType;
    if (baseType && stypes.includes(baseType)) {
      needs.base = baseType.shortName;
      needs.baseModule = `./${kebab(baseType.shortName)}${opts.ext}`;
    }

    const fileName = `${kebab(stype.shortName)}.ts`;
    const path = join(outDir, fileName);
    const notes = [];
    let contents;

    if (existsSync(path)) {
      // Split on either ending. A CRLF checkout - which is what git gives a Windows clone by
      // default - otherwise leaves a trailing \r on every line, and `.` does not match \r in
      // JavaScript, so the `(\/\/.*)?$` at the end of ANY_DECLARATION_RE stops matching. Every
      // declared property then reads as "not declared" and the whole class is appended again.
      // write() puts the file's own endings back.
      let lines = readFileSync(path, 'utf8').split(/\r?\n/);

      // `// @manual-file` is the caller saying the file is theirs. Nothing below runs, not even
      // the header stamp - the point of it is that the file comes back byte for byte.
      if (isManualFile(lines)) {
        console.log(`  keep ${fileName}  - ${MANUAL_FILE_MARK}`);
        generated.push({ shortName: stype.shortName, isComplexType });
        continue;
      }

      // A file with no header is one the generator has never written. Taking it over rewrites
      // declarations somebody typed, so it is reported and skipped unless --adopt says otherwise.
      if (!hasGeneratedHeader(lines) && !opts.adopt) {
        reportAdoptable(fileName, stype.shortName, members);
        generated.push({ shortName: stype.shortName, isComplexType });
        continue;
      }

      const [headed, wasVersion] = applyHeader(lines, 'members');
      lines = headed;
      if (wasVersion && wasVersion !== GENERATOR_VERSION) {
        notes.push(`generated by v${wasVersion}, now v${GENERATOR_VERSION}`);
      } else if (!wasVersion) {
        notes.push(`adopting a file the generator did not write`);
      }
      lines = reconcileClassDeclaration(lines, stype.shortName, needs, isComplexType, notes);
      lines = reconcileProperties(lines, stype.shortName, members, notes);
      lines = reconcileImports(lines, requiredImports(needs, opts, stype.shortName), notes);
      contents = lines.join('\n');
    } else {
      contents = renderNewFile(stype, members, needs, opts, isComplexType);
    }
    write(fileName, contents, notes);
    generated.push({ shortName: stype.shortName, isComplexType });
  }

  if (opts.index) write('index.ts', renderIndex(generated, opts));

  // A file for a type that has left the metadata is reported, never deleted.
  const known = new Set(['entity-base.ts', 'index.ts',
    ...[rootBase(opts, false), rootBase(opts, true)]
      .filter(r => r.isCustom && r.file)
      .map(r => r.file),
    ...generated.map(g => `${kebab(g.shortName)}.ts`)]);
  for (const name of readdirSync(outDir)) {
    if (/\.ts$/.test(name) && !known.has(name)) {
      console.log(`  ?    ${name} has no type in this metadata - delete it by hand if it is stale`);
    }
  }

  console.log(opts.dryRun
    ? `${changed} file(s) would change (dry run)`
    : `${changed} file(s) written`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
