// @ts-check
/**
 * Generates the API reference as markdown into the VitePress site, so guides and
 * API share one navigation and one search index.
 *
 * Run via `npm run docs:api`; `npm run docs:dev` and `docs:build` run it first.
 */
/** @type {Partial<import('typedoc').TypeDocOptions>} */
export default {
  // Not src/breeze.ts: scripts/docs-entry.ts re-exports it plus the optional mixins, which
  // an application imports from their own subpaths. Its header says why one entry point and
  // not three.
  entryPoints: ['scripts/docs-entry.ts'],
  // typedoc-require-docs fails the build on an entry with no description; its header says what counts.
  plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme', './scripts/typedoc-categories.mjs', './scripts/typedoc-require-docs.mjs'],
  out: 'docs/api',
  // Sidebar links are computed relative to this. Without it they come out as
  // /docs/api/... instead of the /api/... the site actually serves.
  docsRoot: './docs',
  excludePrivate: true,
  // Internal types that public signatures happen to mention. Deliberately not exported;
  // listing them stops TypeDoc warning about each one on every run.
  intentionallyNotExported: [
    'InterfaceDef', 'Op', 'Param', 'RecursiveArray', 'QueryOp', 'BooleanQueryOp',
    'src/core/core.ts:Predicate',
    // The path machinery in src/query/property-path.ts: helpers that the exported path and
    // operator types are built from.
    'ElementOf', 'RawPropertyPath', 'RawCollectionPath', 'RawNavigationPath',
    'RawPropertyValue', 'RawSelectPath', 'WhereKey', 'EqualityOps', 'ComparisonOps', 'StringOps', 'InOp',
    // The save-queuing mixin's internal bookkeeping, named by QueuedSaveFailedError.failedSaveMemo.
    'SaveMemo',
  ],
  excludeInternal: true,
  readme: 'none',
  githubPages: false,

  // Organise the reference by purpose rather than by declaration kind. The categories, and
  // why they are applied by a plugin instead of by @category tags in the source, are in
  // scripts/typedoc-categories.mjs. categorizeByGroup: false lifts categories above the
  // Classes/Interfaces/... split rather than repeating them inside each one.
  categorizeByGroup: false,
  navigation: { includeCategories: true, includeGroups: false },
  categoryOrder: [
    'Working with data',
    'Metadata',
    'Validation',
    'Events',
    'Configuration',
    'Typed query paths',
    'Constructor config objects',
    'Adapters and extension points',
    'Optional extensions',
    '2.x compatibility',
    '*',   // anything the plugin warned about, so a new export is visible rather than lost
  ],

  // Breeze's own doc tags. Declaring them makes TypeDoc render them rather than
  // warn on every run. The ones TypeScript already expresses - @method, @static,
  // @class, @dynamic - were deleted from the source instead, since they said nothing
  // the type signature did not.
  blockTags: [
    '@param', '@returns', '@example', '@deprecated', '@see', '@throws', '@defaultValue',
    '@adapter',    // names the adapter interface a class implements
    '@eventArgs',  // documents the args type of a BreezeEvent
    '@chainable',  // returns this, so calls can be chained
    '@summary',
    '@event',
    '@property',
  ],
  modifierTags: ['@hidden', '@internal', '@readonly', '@virtual', '@override'],
};
