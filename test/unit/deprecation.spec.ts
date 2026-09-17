import ts from 'typescript';
import { fileURLToPath } from 'node:url';

// The callback arguments on Breeze's async methods are deprecated in favour of the promise.
// `tsc` never reports deprecation - it is a language-service feature - so the only way to know
// whether an editor actually strikes a call through is to ask the language service, the way an
// editor does.
//
// The trap this pins down: because the callback parameters are all optional, a deprecated
// overload declared FIRST also matches `em.executeQuery(query)`, and every caller gets a
// strikethrough for code that is already correct. The promise-only overload has to come first.
// Swap the order in the source and the "promise form" cases below fail.

// TypeScript normalises paths to forward slashes, so these must be too, or the in-memory
// probe below is never matched by identity and the program reports its root file as missing.
const slashed = (url: URL) => fileURLToPath(url).replace(/\\/g, '/');
const probePath = slashed(new URL('./.deprecation-probe.ts', import.meta.url));
const breezePath = slashed(new URL('../../src/breeze.ts', import.meta.url));

const PROMISE_FORM = [
  `em.executeQuery(q)`,
  `em.executeQuery('Orders')`,
  `em.saveChanges()`,
  `em.saveChanges([e])`,
  `em.saveChanges([e], so)`,
  `em.fetchMetadata()`,
  `em.fetchMetadata(ds)`,
  `q.execute()`,
  `e.entityAspect.loadNavigationProperty('orders')`,
  `ms.fetchMetadata('breeze/Northwind')`,
];

const CALLBACK_FORM = [
  `em.executeQuery(q, (d: any) => d)`,
  `em.executeQuery('Orders', (d: any) => d)`,
  `em.saveChanges([e], so, (r: any) => r)`,
  `em.fetchMetadata(ds, (r: any) => r)`,
  `q.execute((d: any) => d)`,
  `e.entityAspect.loadNavigationProperty('orders', (d: any) => d)`,
  `ms.fetchMetadata('breeze/Northwind', (r: any) => r)`,
];

const header = `
import { EntityManager, EntityQuery, Entity, SaveOptions, MetadataStore, DataService } from '${breezePath.replace(/\\/g, '/')}';
declare const em: EntityManager;
declare const q: EntityQuery;
declare const ms: MetadataStore;
declare const ds: DataService;
declare const e: Entity;
declare const so: SaveOptions;
async function probe() {
`;

const calls = [...PROMISE_FORM, ...CALLBACK_FORM];
const source = header + calls.map(c => `  await ${c};`).join('\n') + '\n}\n';
// The first call sits on the line after the `async function probe() {` line.
const firstCallLine = header.split('\n').length - 1;

/** The set of calls an editor would render struck through. */
function deprecatedCalls(): Set<string> {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [probePath],
    getScriptVersion: () => '1',
    getScriptSnapshot: f => f === probePath
      ? ts.ScriptSnapshot.fromString(source)
      : (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!) : undefined),
    getCurrentDirectory: () => fileURLToPath(new URL('../../', import.meta.url)),
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,   // the probe imports src/breeze.ts by path
    }),
    getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
    // The probe is held in memory rather than written into the source tree, so it has to be
    // reported as existing or the program treats its own root file as missing.
    fileExists: f => f === probePath || ts.sys.fileExists(f),
    readFile: f => (f === probePath ? source : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host);
  const program = service.getProgram()!;
  const sourceFile = program.getSourceFile(probePath)!;

  // A probe that does not compile would report nothing and pass everything vacuously.
  const errors = ts.getPreEmitDiagnostics(program, sourceFile)
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  if (errors.length) throw new Error('the probe does not compile:\n  ' + errors.join('\n  '));

  const struck = new Set<string>();
  for (const d of service.getSuggestionDiagnostics(probePath)) {
    if (!d.reportsDeprecated) continue;
    const { line } = ts.getLineAndCharacterOfPosition(sourceFile, d.start!);
    const call = calls[line - firstCallLine];
    if (call) struck.add(call);
  }
  return struck;
}

describe("the deprecated callback arguments", () => {

  let struck: Set<string>;
  beforeAll(() => { struck = deprecatedCalls(); });

  test.each(CALLBACK_FORM)("%s is marked deprecated", call => {
    expect(struck.has(call)).toBe(true);
  });

  // The half that actually regresses: an overload ordering mistake flags correct code.
  test.each(PROMISE_FORM)("%s is not", call => {
    expect(struck.has(call)).toBe(false);
  });

});
