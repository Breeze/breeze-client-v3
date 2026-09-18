import * as fs from 'node:fs';
import ts from 'typescript';
import metadata from '../support/NorthwindIBMetadata.json';

// package.json marks Breeze side-effect-free apart from the entity-graph mixin. A bundler may
// then drop any module none of whose exports the application uses, drop imports made only for
// their effect, and - webpack does this - skip the barrel and load whichever module an export
// comes from first. These tests pin down what makes that safe. See the "sideEffects" section
// of CHANGES-DEV.md.

const srcDir = new URL('../../src/', import.meta.url);
// src/ is grouped by concern, so walk it: names come back as 'core/core', 'config/config', ...
const moduleNames = (function walk(dir, prefix = ''): string[] {
  return fs.readdirSync(new URL(dir, srcDir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(`${dir}${e.name}/`, `${prefix}${e.name}/`)
                    : e.name.endsWith('.ts') ? [prefix + e.name.slice(0, -3)] : []);
})('./');

describe("each module, loaded without the barrel", () => {

  beforeEach(() => {
    vi.resetModules();
  });

  test.each(moduleNames)("%s loads first without an import-cycle error", async (name) => {
    await expect(import(/* @vite-ignore */ `../../src/${name}`)).resolves.toBeDefined();
  });

  test("config has its adapter interfaces without interface-registry.ts", async () => {
    const { config } = await import('../../src/config/config');
    expect(config.getInterfaceDef('dataService').name).toBe('dataService');
    expect(typeof config.initializeAdapterInstances).toBe('function');
  });

  test("a MetadataStore gets the default model library without an EntityManager", async () => {
    const { MetadataStore } = await import('../../src/metadata/entity-metadata');
    const ms = new MetadataStore();
    ms.importMetadata(metadata);
    const cust = (ms.getAsEntityType('Customer') as any).createEntity({ companyName: 'Metadata only' });
    expect(cust.companyName).toBe('Metadata only');
    expect(cust.entityAspect.entityState.name).toBe('Detached');
  });

  test("an EntityManager gets the default server adapters without the barrel", async () => {
    const { config } = await import('../../src/config/config');
    await import('../../src/manager/entity-manager');
    expect(config.getAdapterInstance('dataService')!.name).toBe('webApi');
    expect(config.getAdapterInstance('uriBuilder')!.name).toBe('json');
  });

  test("Param checks entities without entity-metadata.ts", async () => {
    const { assertParam } = await import('../../src/core/assert-param');
    expect(() => assertParam({ entityType: {} }, 'entity').isEntity().check()).not.toThrow();
    expect(() => assertParam({}, 'entity').isEntity().check()).toThrow(/must be an entity/);
    expect(() => assertParam({ isDataProperty: true }, 'p').isEntityProperty().check()).not.toThrow();
  });
});

// Top-level statements that act on something the module imports. Under "sideEffects": false such
// a statement runs only if the bundler keeps its module, which it does only if something uses one
// of the module's exports. Each one here is safe for the reason given; a new one needs a reason
// too - or, better, an explicit call from code that uses it. Statements that act only on the
// module's own declarations (prototype branding, resolveSymbols) are not listed: whoever needs
// them uses the module's exports. Class static initializers and variable initializers are not
// scanned.
const legacyCore = "2.x alias on core. Nothing in Breeze reads it; it is set whenever config.ts is bundled";
const ownPrototype = "patches this module's own class";
const allowed: [file: string, statement: string, why: string][] = [
  ['core/assert-param.ts', '(core as any).Param = Param;', legacyCore],
  ['core/assert-param.ts', '(core as any).assertParam = assertParam;', legacyCore],
  ['core/assert-param.ts', '(core as any).assertConfig = assertConfig;', legacyCore],
  ['breeze.ts', 'try {', "window.breeze: kept only when the bundle uses the breeze object, which holds every class anyway"],
  ['breeze.ts', 'if (win) {', "window.breeze, as above"],
  ['config/config.ts', '(core as any).config = config;', legacyCore],
  ['entity/entity-aspect.ts', 'BreezeEvent.bubbleEvent(EntityAspect.prototype,', ownPrototype],
  ['manager/entity-manager.ts', 'BreezeEvent.bubbleEvent(EntityManager.prototype);', ownPrototype],
  ['manager/entity-manager.ts', 'setDefaultAdapters(serverDefaultAdapters);', "server-side default adapters: every bundle that talks to a server has an EntityManager"],
  ['metadata/entity-metadata.ts', 'BreezeEvent.bubbleEvent(MetadataStore.prototype);', ownPrototype],
  ['metadata/entity-metadata.ts', 'setDefaultAdapters({ modelLibrary:', "default model library: every bundle with entity types has this module"],
  ['core/event.ts', '(core as any).Event = BreezeEvent;', legacyCore],
  ['entity/key-generator.ts', 'config.registerType(KeyGenerator,', "brands its own class; readers pass the class"],
  ['mixins/mixin-get-entity-graph.ts', 'mixinEntityGraph(EntityManager);', "imported for its effect by design: listed in package.json sideEffects"],
  ['validation/validate.ts', 'core.objectForEach(Validator,', "registers its own validators; only Validator.fromJSON reads them"],
];

function rootName(e: ts.Expression): string | undefined {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    else if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e)) e = e.expression;
    else return ts.isIdentifier(e) ? e.text : undefined;
  }
}

function touchesImport(e: ts.Expression, imported: Set<string>): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return imported.has(rootName(e.left)!) || (ts.isCallExpression(e.right) && touchesImport(e.right, imported));
  }
  if (ts.isCallExpression(e)) {
    return imported.has(rootName(e.expression)!) || e.arguments.some(a => imported.has(rootName(a)!));
  }
  return false;
}

function topLevelEffects(file: string): string[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(new URL(file, srcDir), 'utf8'), ts.ScriptTarget.Latest, true);
  const imported = new Set<string>();
  const found: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const clause = st.importClause;
    if (!clause) { found.push(st.getText()); continue; }   // an import for effect: a bundler drops it
    if (clause.isTypeOnly) continue;
    if (clause.name) imported.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) imported.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach(el => { if (!el.isTypeOnly) imported.add(el.name.text); });
  }
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) ? touchesImport(st.expression, imported) : (ts.isIfStatement(st) || ts.isTryStatement(st))) {
      found.push(st.getText().replace(/\s+/g, ' '));
    }
  }
  return found;
}

describe("import-time effects", () => {

  test("every top-level statement that acts on an import is accounted for", () => {
    const unexplained: string[] = [];
    const used = new Set<number>();
    for (const file of moduleNames.map(n => n + '.ts')) {
      for (const statement of topLevelEffects(file)) {
        const ix = allowed.findIndex(([f, s]) => f === file && statement.startsWith(s));
        if (ix < 0) unexplained.push(`${file}: ${statement.slice(0, 100)}`);
        else used.add(ix);
      }
    }
    expect(unexplained).toEqual([]);
    // Keep the list honest: drop an entry once its statement is gone.
    expect(allowed.filter((_, ix) => !used.has(ix)).map(([f, s]) => `${f}: ${s}`)).toEqual([]);
  });

  test("package.json lists only the modules imported for their effect", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.sideEffects).toEqual(['./dist/mixins/mixin-get-entity-graph.js']);
  });
});

// rxjs is opt-in, like the save-queuing mixin: an application imports breeze-client/rxjs and
// installs rxjs itself, or it gets neither. These make that a checked fact rather than a
// convention, because the failure is invisible from inside this repo - rxjs is a devDependency
// here, so an import of it from a core module would build, pass every test, and then fail to
// resolve in every application that did not happen to have rxjs already.
describe("optional dependencies", () => {

  /** Every module reachable from `entry` through relative imports, value AND type-only. */
  function reachableFrom(entry: string): Map<string, string[]> {
    const graph = new Map<string, string[]>();        // module -> its bare (package) specifiers
    const pending = [entry];
    while (pending.length) {
      const name = pending.pop()!;
      if (graph.has(name)) continue;
      const file = `${name}.ts`;
      const sf = ts.createSourceFile(file, fs.readFileSync(new URL(file, srcDir), 'utf8'), ts.ScriptTarget.Latest, true);
      const bare: string[] = [];
      for (const st of sf.statements) {
        // `export ... from` pulls a module in exactly as an import does
        const spec = (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier
          && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : undefined;
        if (!spec) continue;
        if (spec.startsWith('.')) {
          const target = new URL(spec.replace(/\.js$/, ''), new URL(file, srcDir));
          pending.push(target.pathname.slice(srcDir.pathname.length));
        } else {
          bare.push(spec);
        }
      }
      graph.set(name, bare);
    }
    return graph;
  }

  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  // rxjs, @angular/common - whatever the opt-in extensions need, read from package.json.
  const optionalPeers = Object.keys(pkg.peerDependencies ?? {});
  const isOptionalPeer = (spec: string) => optionalPeers.some(p => spec === p || spec.startsWith(p + '/'));

  test("the optional peers are the ones this test expects", () => {
    // Fails when one is added, so that whoever adds it reads the tests below.
    expect(optionalPeers.sort()).toEqual(['@angular/common', 'rxjs']);
  });

  test("nothing reachable from breeze-client imports an optional peer, not even for a type", () => {
    // Type-only imports count: they are erased from the JavaScript but not from the published
    // .d.ts, so a TypeScript application without rxjs or Angular would fail to compile against Breeze.
    const offenders = [...reachableFrom('breeze')]
      .filter(([, bare]) => bare.some(isOptionalPeer))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  test.each([
    ['rxjs/breeze-rxjs', './rxjs'],
    ['angular/adapter-angular-httpclient', './adapter-angular-httpclient'],
  ])("%s is only reachable through its own subpath", (module, subpath) => {
    expect(reachableFrom('breeze').has(module)).toBe(false);
    expect(pkg.exports[subpath].default).toBe(`./dist/${module}.js`);
  });

  test.each(optionalPeers)("package.json asks for %s only as an optional peer", peer => {
    expect(pkg.dependencies?.[peer]).toBeUndefined();
    // Without `optional`, npm 7 and later install a peer dependency automatically - for everyone.
    expect(pkg.peerDependenciesMeta?.[peer]?.optional).toBe(true);
  });
});

// Every opt-in extension is listed in one place, docs/guide/extensions.md, reached from one link
// under Advanced in the sidebar. These keep the list complete as extensions are added: a new
// subpath in package.json that is neither the main entry nor one of Breeze's own adapters - which
// are the modules published from dist/adapters - is an extension, and fails here until the page
// names it. By folder rather than by name: adapter-angular-httpclient is an adapter by name and an
// opt-in extension by nature.
describe("optional extensions are all documented", () => {

  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const subpaths = Object.keys(pkg.exports).filter(k => k !== '.' && k !== './package.json');
  const extensions = subpaths.filter(k => !pkg.exports[k].default.startsWith('./dist/adapters/'));
  const doc = (page: string) => fs.readFileSync(new URL(`../../docs/guide/${page}.md`, import.meta.url), 'utf8');

  test("the extensions are the ones this test expects", () => {
    // Fails when one is added or removed, so that whoever does it reads the two below.
    expect(extensions.sort()).toEqual([
      './adapter-angular-httpclient', './mixin-get-entity-graph', './mixin-save-queuing', './rxjs',
    ]);
  });

  test.each(extensions)("%s is on the Optional extensions page", subpath => {
    expect(doc('extensions')).toContain(`breeze-client/${subpath.slice(2)}`);
  });

  test.each(subpaths)("%s is in Configuration's table of everything importable", subpath => {
    expect(doc('configuration')).toContain(`\`breeze-client/${subpath.slice(2)}\``);
  });
});

// Not about side effects, but this file is already the one that reads src/ off disk.
//
// TypeScript attaches only the LAST doc comment before a declaration, so a second `/** ... */`
// silently throws away everything in the first - including `@hidden @internal`, which decides
// whether a member reaches the published .d.ts and the API reference, and `@deprecated`, which
// decides whether an editor warns anybody. It looks harmless and reads as two comments about the
// same thing, which is why it has happened five times in this repository. Two of those were
// discarding `@hidden @internal` on members that were meant to be invisible.
describe("doc comments", () => {

  // TypeDoc keeps only the doc comment nearest a declaration, so the first of two is silently
  // lost - which is how EntityType.createEntity lost its @returns and two config methods their
  // descriptions. A comment that is not about the declaration below it belongs in /* */.
  test("no declaration is preceded by two of them", () => {
    const stacked: string[] = [];
    for (const name of moduleNames) {
      const lines = fs.readFileSync(new URL(`${name}.ts`, srcDir), 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim().endsWith('*/')) continue;
        let start = i;
        while (start > 0 && !lines[start].includes('/*')) start--;
        if (!lines[start].includes('/**')) continue;      // a plain /* */ above a doc comment is fine
        let next = i + 1;
        while (next < lines.length && lines[next].trim() === '') next++;
        if (lines[next]?.trim().startsWith('/**')) {
          stacked.push(`${name}.ts:${start + 1}  discarded: ${lines[start].trim()} ${lines[start + 1]?.trim() ?? ''}`);
        }
      }
    }
    expect(stacked).toEqual([]);
  });

  // TypeDoc keeps the extra `*` of a `**/` as text: a stray `*` after the description, or an empty
  // bullet when the closer has a line of its own. There were 358 of them.
  test("close with */, not **/", () => {
    const closers: string[] = [];
    for (const name of moduleNames) {
      const lines = fs.readFileSync(new URL(`${name}.ts`, srcDir), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.trim().startsWith('//') && /\*\*+\/\s*$/.test(line)) closers.push(`${name}.ts:${i + 1}`);
      });
    }
    expect(closers).toEqual([]);
  });
});
