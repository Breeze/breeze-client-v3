/**
 * Shared resolution for every tier.
 *
 * `test/model/` imports Breeze by its published name, `breeze-client`, because those files are
 * what the generator writes for an application and they should read the way an application's do.
 * Inside this repo that name has to point back at the sources.
 *
 * Without the alias it would still resolve - package.json has an `exports` map, so Node and Vite
 * honour the self-reference - but it would resolve to `dist/`, and a spec that imports
 * `../../src/breeze` would then be holding a *different* copy of Breeze from the model it is
 * testing. Two copies means two `EntityState` enums, two `DataType` tables and `instanceof`
 * checks that fail for no visible reason.
 *
 * Today the generated files import only types, which esbuild erases, so nothing would actually
 * load. The alias is here for the moment someone adds a real import to a model class.
 *
 * The matching compile-time half is `paths` in test/tsconfig.json.
 */
import { fileURLToPath } from 'node:url';

export const breezeAlias = {
  'breeze-client': fileURLToPath(new URL('./src/breeze.ts', import.meta.url)),
};
