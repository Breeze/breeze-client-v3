// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { Category } from './category'; // @generated
import type { Supplier } from './supplier'; // @generated

/**
 * Product:#Foo - the entity type, queried as `Products`.
 * Key: productID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Product extends EntityBase {
  declare productID: number;  // @generated
  declare productName: string;  // @generated
  declare supplierID: number;  // @generated
  declare categoryID: number;  // @generated
  declare quantityPerUnit: string;  // @generated
  declare unitPrice: number;  // @generated
  declare unitsInStock: number;  // @generated
  declare unitsOnOrder: number;  // @generated
  declare reorderLevel: number;  // @generated
  declare isDiscontinued: boolean;  // @generated
  declare discontinuedDate: Date;  // @generated
  declare rowVersion: number;  // @generated
  declare category: Category;  // @generated
  declare supplier: Supplier;  // @generated
}
