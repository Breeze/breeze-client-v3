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
