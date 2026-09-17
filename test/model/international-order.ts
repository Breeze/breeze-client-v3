// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated
import type { Order } from './order'; // @generated

/**
 * InternationalOrder:#Foo - the entity type, queried as `InternationalOrders`.
 * Key: orderID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class InternationalOrder extends EntityBase {
  declare orderID: number;  // @generated
  declare customsDescription: string;  // @generated
  declare exciseTax: number;  // @generated
  declare rowVersion: number;  // @generated
  declare order: Order;  // @generated
}
