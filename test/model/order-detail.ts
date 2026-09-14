// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { Order } from './order'; // @generated
import type { Product } from './product'; // @generated

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
