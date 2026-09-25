// @generated-by generate-entity-classes v1.1.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import type { Category } from './category'; // @generated
import type { Supplier } from './supplier'; // @generated
import { EntityBase } from 'breeze-client'; // @generated

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
