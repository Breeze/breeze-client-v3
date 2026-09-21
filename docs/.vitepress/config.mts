import { defineConfig } from 'vitepress';
import typedocSidebar from '../api/typedoc-sidebar.json';
import { SUPPORTING_CATEGORIES, SUPPORTING_GROUP } from '../../scripts/api-tiers.mjs';

/**
 * The API sidebar in two tiers - see scripts/api-tiers.mjs. The API itself is open; the types that
 * only describe what it takes and returns are one collapsed group at the bottom, reached mostly by
 * following a link from a signature. A category neither list names - one TypeDoc made for a new,
 * uncategorised export - stays in the first tier, where it will be noticed.
 */
const apiSidebar = [
  ...typedocSidebar
    .filter(group => !SUPPORTING_CATEGORIES.includes(group.text))
    .map(group => ({ ...group, collapsed: false })),
  {
    text: SUPPORTING_GROUP,
    collapsed: true,
    items: typedocSidebar.filter(group => SUPPORTING_CATEGORIES.includes(group.text)),
  },
];

/**
 * The single sidebar, shared by /guide/, /query/, /metadata/ and /server/.
 *
 * Querying appears twice on purpose and they are different things: the Core concepts entry is
 * the tour, and the group below it is the reference. The API reference has its own generated
 * sidebar.
 */
const docsSidebar = [
  {
    text: 'Introduction',
    items: [
      { text: 'What is Breeze?', link: '/guide/what-is-breeze' },
      { text: 'Getting started', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/guide/configuration' },
      { text: 'Migrating from 2.x', link: '/guide/migrating-from-2x' },
    ],
  },
  {
    text: 'Frameworks',
    items: [
      { text: 'Angular', link: '/guide/angular' },
      { text: 'React', link: '/guide/react' },
    ],
  },
  {
    text: 'Core concepts',
    items: [
      { text: 'Inside the entity', link: '/guide/inside-the-entity' },
      { text: 'Generating entity classes', link: '/guide/generating-entities' },
      { text: 'Typed entities', link: '/guide/typed-entities' },
      { text: 'Extending entities', link: '/guide/extending-entities' },
      { text: 'Querying', link: '/guide/querying' },
      { text: 'Typed queries', link: '/guide/typed-queries' },
      { text: 'Creating entities', link: '/guide/creating-entities' },
      { text: 'Navigation properties', link: '/guide/navigation-properties' },
      { text: 'Complex properties', link: '/guide/complex-properties' },
      { text: 'Change tracking', link: '/guide/change-tracking' },
      { text: 'EntityManager and caching', link: '/guide/entitymanager-and-caching' },
      { text: 'Saving changes', link: '/guide/saving-changes' },
      { text: 'Validation', link: '/guide/validation' },
      { text: 'Error handling', link: '/guide/error-handling' },
      { text: 'Export and import', link: '/guide/export-import' },
    ],
  },
  {
    text: 'Querying in depth',
    collapsed: false,
    items: [
      { text: 'How queries work', link: '/query/' },
      { text: 'Query examples', link: '/query/examples' },
      { text: 'Where clauses', link: '/query/predicates' },
      { text: 'Ordering, paging, expand', link: '/query/shaping' },
      { text: 'Projections', link: '/query/projections' },
      { text: 'Querying the cache', link: '/query/locally' },
      { text: 'Debugging queries', link: '/query/debugging' },
    ],
  },
  {
    text: 'Advanced',
    collapsed: true,
    items: [
      { text: 'Date and time', link: '/guide/date-and-time' },
      { text: 'Performance', link: '/guide/performance' },
      { text: 'Performance vs 2.x', link: '/guide/performance-vs-2x' },
      { text: 'Testing', link: '/guide/testing' },
      // Everything opt-in, under one link, one child per extension. A new one goes here and in
      // docs/guide/extensions.md; side-effects.spec.ts fails until that page lists it.
      {
        text: 'Optional extensions',
        link: '/guide/extensions',
        collapsed: true,
        items: [
          { text: 'Save queuing', link: '/guide/extensions#save-queuing' },
          { text: 'Entity graphs', link: '/guide/extensions#entity-graphs' },
          { text: 'RxJS', link: '/guide/rxjs' },
          { text: 'Angular HttpClient', link: '/guide/extensions#angular-httpclient' },
        ],
      },
    ],
  },
  {
    text: 'Metadata',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/metadata/' },
      { text: 'Metadata in depth', link: '/metadata/details' },
      { text: 'Writing metadata by hand', link: '/metadata/by-hand' },
      { text: 'Custom metadata', link: '/metadata/custom' },
    ],
  },
  {
    text: 'Talking to the server',
    collapsed: true,
    items: [
      { text: 'Overview', link: '/server/' },
      { text: 'Using a Breeze .NET server', link: '/server/dotnet' },
      { text: 'Supplying your own transport', link: '/server/transport' },
      { text: 'DataServiceAdapter', link: '/server/dataserviceadapter' },
      { text: 'Transforming JSON results', link: '/server/jsonresultsadapter' },
      { text: 'Naming conventions', link: '/server/namingconvention' },
    ],
  },
];

export default defineConfig({
  title: 'Breeze',
  description: 'Data management for JavaScript clients',
  lang: 'en-US',
  // Where the site is served from. GitHub Pages serves this repo at /breeze-client-v3/, and
  // scripts/publish-docs.mjs sets DOCS_BASE to that; `docs:dev` and `docs:build` serve from /.
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  lastUpdated: true,

  // The API reference is generated by TypeDoc before the site builds.
  ignoreDeadLinks: false,

  themeConfig: {
    search: { provider: 'local' },

    nav: [
      { text: 'Guide', link: '/guide/what-is-breeze' },
      { text: 'API', link: '/api/' },
      { text: 'Migrating from 2.x', link: '/guide/migrating-from-2x' },
      {
        text: 'Server',
        items: [
          // The .NET docs are a DocFX site in breeze-server-v3 and are not published yet, so
          // these point at the page here that explains what the server gives you and how to
          // build that site locally, rather than at a GitHub blob URL. Point the first entry
          // at the published site once there is one.
          { text: 'Using a Breeze .NET server', link: '/server/dotnet' },
          { text: 'breeze-server-v3 on GitHub', link: 'https://github.com/Breeze/breeze-server-v3' },
        ],
      },
    ],

    // One sidebar for the whole documentation. Every section is keyed to it, so the left bar is
    // the same wherever you land: arriving at /query/predicates from a search result shows the
    // guide around it rather than a lone group with no way back. The deeper sections start
    // collapsed so the list stays readable.
    sidebar: {
      '/guide/': docsSidebar,
      '/query/': docsSidebar,
      '/metadata/': docsSidebar,
      '/server/': docsSidebar,
      '/api/': apiSidebar,
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Breeze/breeze-client-v3' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © IdeaBlade',
    },

    editLink: {
      pattern: 'https://github.com/Breeze/breeze-client-v3/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
