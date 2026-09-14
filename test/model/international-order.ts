// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

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
