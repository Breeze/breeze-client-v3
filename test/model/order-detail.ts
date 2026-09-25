// @generated-by generate-entity-classes v1.1.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import type { Order } from './order'; // @generated
import type { Product } from './product'; // @generated
import { EntityBase } from 'breeze-client'; // @generated

/**
 * OrderDetail:#Foo - the entity type, queried as `OrderDetails`.
 * Key: orderID, productID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class OrderDetail extends EntityBase {
  declare orderID: number;  // @generated
  declare productID: number;  // @generated
  declare unitPrice: number;  // @generated
  declare quantity: number;  // @generated
  declare discount: number;  // @generated
  declare rowVersion: number;  // @generated
  declare order: Order;  // @generated
  declare product: Product;  // @generated
}
