// @ts-check
/**
 * The API reference in two tiers, shared by typedoc.config.mjs (the order of the categories on
 * the index page) and docs/.vitepress/config.mts (the sidebar).
 *
 * The first tier is the API itself: the classes, enums and functions an application constructs
 * or calls. The second is everything that only describes the shape of what those take or return -
 * `QueriedAs`, `QueryResult`, event arguments, config objects, the typed-path machinery. Those
 * pages exist so that a signature's links lead somewhere, but a reader browsing the reference
 * should not have to wade through them to find `EntityManager`. In the sidebar the second tier is
 * one collapsed group at the bottom.
 *
 * Which category a symbol is in is set in scripts/typedoc-categories.mjs.
 */

/** The API itself, in the order the sidebar and index show it. */
export const PRIMARY_CATEGORIES = [
  'Working with data',
  'Metadata',
  'Validation',
  'Events',
  'Configuration',
  'Optional extensions',
];

/** The shapes, under one collapsed sidebar group. */
export const SUPPORTING_CATEGORIES = [
  'Results and arguments',
  'Typed query paths',
  'Config objects',
  'Adapters and extension points',
  '2.x compatibility',
];

/** The sidebar group the supporting categories sit under. */
export const SUPPORTING_GROUP = 'Supporting types';
