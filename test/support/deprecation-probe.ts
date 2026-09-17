import ts from 'typescript';
import { fileURLToPath } from 'node:url';

/**
 * Asks the TypeScript language service which expressions an editor would render struck through.
 *
 * `tsc` never reports deprecation - it is a language-service feature - so this is the only way to
 * find out whether `@deprecated` in the source actually reaches anybody. It compiles a probe file
 * held in memory against `src/`, exactly as an editor would, and returns the expressions that came
 * back with `reportsDeprecated`.
 *
 * @param header - imports, `declare const` lines, and the opening of a function to hold the
 *   expressions. Must end with a newline; the first expression lands on the next line.
 * @param expressions - one per line, each rendered by `render`.
 * @param render - how to turn an expression into a statement. Defaults to `await`ing it, which
 *   is valid for a non-promise too.
 * @param footer - closes whatever `header` opened.
 */
export function struckThrough(
  header: string,
  expressions: string[],
  render: (expr: string) => string = expr => `  await ${expr};`,
  footer = '}\n',
): Set<string> {
  // TypeScript normalises paths to forward slashes, so these must be too, or the in-memory probe
  // is never matched by identity and the program reports its root file as missing.
  const probePath = fileURLToPath(new URL('./.deprecation-probe.ts', import.meta.url))
    .replace(/\\/g, '/');
  const source = header + expressions.map(render).join('\n') + '\n' + footer;
  // The first expression sits on the line after the last line of the header.
  const firstLine = header.split('\n').length - 1;

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
      allowImportingTsExtensions: true,   // the probe imports src/ by path
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
    const expr = expressions[line - firstLine];
    if (expr) struck.add(expr);
  }
  return struck;
}

/** `src/breeze.ts`, spelled the way the probe's import needs. */
export const breezePath = fileURLToPath(new URL('../../src/breeze.ts', import.meta.url))
  .replace(/\\/g, '/');
