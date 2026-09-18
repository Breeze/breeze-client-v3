/**
 * The single entry point TypeDoc reads. Not part of the package: nothing imports it, it is
 * outside `src/` so `tsc -p tsconfig.build.json` does not compile it into `dist/`, and it is
 * absent from the `exports` map in package.json.
 *
 * It exists because the reference should cover the optional mixins, which an application
 * imports from their own subpaths and which `src/breeze.ts` therefore does not re-export:
 *
 *     import { enableSaveQueuing } from 'breeze-client/mixin-save-queuing';
 *     import 'breeze-client/mixin-get-entity-graph';
 *
 * Listing those files in `entryPoints` alongside `src/breeze.ts` is the obvious way to do
 * that and is wrong here for two reasons. TypeDoc gives each entry point a module of its
 * own, so every page moves from `/api/classes/EntityManager` to
 * `/api/breeze/classes/EntityManager` - 54 links in the guides, plus anything anyone has
 * bookmarked. And `scripts/typedoc-categories.mjs` only categorises reflections whose parent
 * is the project, which under modules is nothing at all, so the reference loses its taxonomy
 * and falls back to Classes / Interfaces / Type aliases.
 *
 * One entry point that re-exports keeps both: the flat structure and every existing URL.
 *
 * `export *` deliberately, not a list: a new export from any of these modules then appears in
 * the reference by itself, and the category plugin warns until it has been placed.
 */
export * from '../src/breeze.js';

// enableSaveQueuing, QueuedSaveFailedError
export * from '../src/mixins/mixin-save-queuing.js';

// mixinEntityGraph, HasEntityGraph. Importing this module patches EntityManager.prototype -
// that is how the mixin works - which is harmless here because nothing runs this file.
export * from '../src/mixins/mixin-get-entity-graph.js';

// fromBreezeEvent, entityChanged$, hasChanges$, validationErrorsChanged$, propertyChanged$.
// breeze-client/rxjs imports rxjs, which is why it is a subpath of its own - see the "optional
// dependencies" tests in side-effects.spec.ts. Re-exporting it here is safe for the same reason
// the mixins are: nothing runs this file.
export * from '../src/rxjs/breeze-rxjs.js';
