// @generated-by generate-entity-classes v1.1.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import type { Location } from './location'; // @generated
import type { Product } from './product'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated
import { EntityBase } from 'breeze-client'; // @generated

/**
 * Supplier:#Foo - the entity type, queried as `Suppliers`.
 * Key: supplierID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Supplier extends EntityBase {
  declare supplierID: number;  // @generated
  declare companyName: string;  // @generated
  declare contactName: string;  // @generated
  declare contactTitle: string;  // @generated
  declare location: Location;  // @generated
  declare phone: string;  // @generated
  declare fax: string;  // @generated
  declare homePage: string;  // @generated
  declare rowVersion: number;  // @generated
  declare products: RelationArray<Product>;  // @generated
}
