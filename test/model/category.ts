// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { Product } from './product'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

/**
 * Category:#Foo - the entity type, queried as `Categories`.
 * Key: categoryID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Category extends EntityBase {
  declare categoryID: number;  // @generated
  declare categoryName: string;  // @generated
  declare description: string;  // @generated
  declare picture: string;  // @generated
  declare rowVersion: number;  // @generated
  declare products: RelationArray<Product>;  // @generated
}
