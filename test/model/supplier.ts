// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import type { RelationArray } from '../../src/breeze'; // @generated
import { EntityBase } from './entity-base'; // @generated
import type { Location } from './location'; // @generated
import type { Product } from './product'; // @generated

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
