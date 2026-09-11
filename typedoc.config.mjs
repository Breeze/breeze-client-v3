// @ts-check
/**
 * Generates the API reference as markdown into the VitePress site, so guides and
 * API share one navigation and one search index.
 *
 * Run via `npm run docs:api`; `npm run docs:dev` and `docs:build` run it first.
 */
/** @type {Partial<import('typedoc').TypeDocOptions>} */
export default {
  entryPoints: ['src/breeze.ts'],
  plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme'],
  out: 'docs/api',
  excludePrivate: true,
  excludeInternal: true,
  readme: 'none',
  githubPages: false,

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
