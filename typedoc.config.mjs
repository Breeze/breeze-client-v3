// @ts-check
/** @type {Partial<import('typedoc').TypeDocOptions>} */
export default {
  entryPoints: ['src/breeze.ts'],
  out: 'docs/api',
  excludePrivate: true,
  excludeInternal: true,
  readme: 'none',
  githubPages: false,

  // Breeze's own doc tags. Declaring them makes TypeDoc render them rather than
  // warn on every run. The ones TypeScript already expresses - @method, @static,
  // @dynamic - were deleted from the source instead, since they carried nothing.
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
