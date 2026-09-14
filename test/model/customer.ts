// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import type { RelationArray } from '../../src/breeze'; // @generated
import { EntityBase } from './entity-base'; // @generated
import type { Order } from './order'; // @generated

/**
 * Customer:#Foo - the entity type, queried as `Customers`.
 * Key: customerID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Customer extends EntityBase {
  declare customerID: string;  // @generated
  declare customerID_OLD: string;  // @generated
  declare companyName: string;  // @generated
  declare contactName: string;  // @generated
  declare contactTitle: string;  // @generated
  declare address: string;  // @generated
  declare city: string;  // @generated
  declare region: string;  // @generated
  declare postalCode: string;  // @generated
  declare country: string;  // @generated
  declare phone: string;  // @generated
  declare fax: string;  // @generated
  declare rowVersion: number;  // @generated
  declare orders: RelationArray<Order>;  // @generated
}
