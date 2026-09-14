#!/usr/bin/env node
// Generate - or update in place - one TypeScript class per structural type in a Breeze
// metadata document.
//
//   node scripts/generate-entity-classes.js --out test/model \
//     --metadata test/support/NorthwindIBMetadata_ETNOPAYLOAD.json
//   node scripts/generate-entity-classes.js --out test/model \
//     --service http://localhost:34377/breeze/NorthwindIBModel
//
// --out and a metadata source are required; nothing can infer either. Everything else has a
// default - the files import from 'breeze-client', which is right wherever the package is
// installed. In this repo, `npm run gen:model` is the spelling with the arguments filled in.
//
// It reads the metadata through the library itself (dist/breeze.js), so naming conventions,
// `nameOnServer`, inheritance and complex types resolve exactly as they do at runtime. Run
// `npm run build` first if dist/ is stale.
//
// Updating is per member, not per file. What the tool owns is marked, and nothing else in the
// file is touched:
//
//   - A property line ending in `// @generated` is rewritten from metadata, in place.
//   - A generated property whose metadata property is gone is removed.
//   - A metadata property the file does not declare is appended, marked.
//   - A metadata property the file declares WITHOUT the marker is left alone: that is a
//     deliberate hand override, and it is reported rather than clobbered.
//   - Imports are added when a generated member needs one. Imports are never removed unless
//     they are marked `// @generated` and nothing in the file still refers to them.
//   - Methods, getters, unmapped properties, comments and hand-written imports survive.
//
// Every generated file carries the generator version in its header, so a later version can tell
// what produced what. See test/model/README.md.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GENERATOR_VERSION = '1.0.0';
const GENERATOR_NAME = 'generate-entity-classes';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The marker that says "this line is mine". */
const MARK = '// @generated';

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
  --metadata <file>   metadata JSON to read
  --service <url>     fetch <url>/Metadata from a running service instead

Required:
  --out <dir>         where the classes go, relative to the repo root

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
  --dry-run, -n       report what would change, write nothing
  --version           print the generator version

Example:
  node scripts/generate-entity-classes.js \\
    --metadata test/support/NorthwindIBMetadata_ETNOPAYLOAD.json \\
    --out test/model`);
}

function fail(msg) {
  console.error(`${GENERATOR_NAME}: ${msg}`);
  process.exit(1);
}

// --- metadata --------------------------------------------------------------------------------

async function loadBreeze() {
  const distPath = join(repoRoot, 'dist', 'breeze.js');
  if (!existsSync(distPath)) fail('dist/breeze.js not found - run `npm run build` first');
  return import(`file://${distPath}`);
}

async function loadMetadata(opts) {
  if (opts.service) {
    const url = opts.service.replace(/\/$/, '') + '/Metadata';
    const response = await fetch(url);
    if (!response.ok) fail(`${url} returned ${response.status} ${response.statusText}`);
    return await response.text();
  }
  const path = resolve(repoRoot, opts.metadata);
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
  /^([ \t]*)(?:(?:public|private|protected|readonly|declare|static|abstract)\s+)*([A-Za-z_$][\w$]*)\s*[?!]?\s*:[^;\n{]*;[ \t]*(\/\/.*)?$/;

function isMarked(line) {
  return /\/\/\s*@generated\b/.test(line);
}

// --- the header ------------------------------------------------------------------------------

const HEADER_FIRST_RE = new RegExp(`^// @generated-by ${GENERATOR_NAME} v([\\w.\\-]+)`);

function renderHeader(scope) {
  return [
    `// @generated-by ${GENERATOR_NAME} v${GENERATOR_VERSION}`,
    scope === 'whole'
      ? '// This whole file is generated. Put hand-written code in a separate module.'
      : `// Lines marked \`${MARK}\` are written from server metadata and are rewritten on every`,
    ...(scope === 'whole' ? [] : ['// run. Everything else in this file is yours and is never touched.']),
  ];
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
    if (!stmt.marked) continue;
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
    if (!stmt.marked) continue;
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

  // 3. Insert the new statements after the last import, or after the header.
  if (additions.length) {
    let at = -1;
    for (let i = 0; i < lines.length; i++) if (IMPORT_RE.test(lines[i])) at = i;
    if (at === -1) {
      at = 0;
      while (at < lines.length && /^\/\//.test(lines[at])) at++;
      lines.splice(at, 0, '');
      at++;
      lines.splice(at, 0, ...additions.map(renderImport));
      return lines;
    }
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
 * Bring the class body's generated properties into line with `members`, leaving every unmarked
 * member, comment and blank line where it is.
 */
function reconcileProperties(lines, className, members, notes) {
  const body = findClassBodyLines(lines, className);
  if (!body) fail(`could not find "class ${className}"`);

  // Index what the class body already declares.
  const declared = new Map();   // name -> { line, indent, marked }
  for (let i = body.first; i <= body.last; i++) {
    const m = ANY_DECLARATION_RE.exec(lines[i]);
    if (m) declared.set(m[2], { line: i, indent: m[1], marked: isMarked(lines[i]) });
  }

  const wanted = new Map(members.map(m => [m.name, m]));
  const indent = [...declared.values()].find(d => d.marked)?.indent
    ?? [...declared.values()][0]?.indent
    ?? '  ';

  // 1. Rewrite or skip what is already there.
  const appended = [];
  for (const member of members) {
    const existing = declared.get(member.name);
    if (!existing) { appended.push(member); continue; }
    if (!existing.marked) {
      notes.push(`${member.name} is declared by hand - left as it is`);
      continue;
    }
    const next = renderProperty(member, existing.indent);
    if (lines[existing.line] !== next) {
      notes.push(`${member.name}: ${member.type}`);
      lines[existing.line] = next;
    }
  }

  // 2. Drop generated properties the metadata no longer has.
  const stale = [...declared.entries()]
    .filter(([name, d]) => d.marked && !wanted.has(name))
    .map(([name, d]) => ({ name, line: d.line }));
  for (const { name, line } of stale.sort((a, b) => b.line - a.line)) {
    notes.push(`remove ${name} - no longer in the metadata`);
    lines.splice(line, 1);
  }

  // 3. Append what is new, after the last generated property, else at the top of the body.
  if (appended.length) {
    const after = findClassBodyLines(lines, className);
    let at = after.first;
    for (let i = after.first; i <= after.last; i++) {
      if (ANY_DECLARATION_RE.test(lines[i]) && isMarked(lines[i])) at = i + 1;
    }
    for (const member of appended) notes.push(`add ${member.name}: ${member.type}`);
    lines.splice(at, 0, ...appended.map(m => renderProperty(m, indent)));
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

  const outDir = resolve(repoRoot, opts.out);
  if (!opts.dryRun) mkdirSync(outDir, { recursive: true });

  console.log(`${GENERATOR_NAME} v${GENERATOR_VERSION}`);
  console.log(`${stypes.length} types from ${opts.service || opts.metadata} -> ${opts.out}`);

  let changed = 0;
  const generated = [];

  const write = (name, contents, notes = []) => {
    const path = join(outDir, name);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
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
      let lines = readFileSync(path, 'utf8').split('\n');
      const [headed, wasVersion] = applyHeader(lines, 'members');
      lines = headed;
      if (wasVersion && wasVersion !== GENERATOR_VERSION) {
        notes.push(`generated by v${wasVersion}, now v${GENERATOR_VERSION}`);
      } else if (!wasVersion) {
        notes.push(`adopting a file the generator did not write`);
      }
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
