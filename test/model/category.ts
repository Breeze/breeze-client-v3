// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

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
