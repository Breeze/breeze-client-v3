// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { Customer } from './customer'; // @generated
import type { Employee } from './employee'; // @generated
import type { InternationalOrder } from './international-order'; // @generated
import type { OrderDetail } from './order-detail'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

/**
 * Order:#Foo - the entity type, queried as `Orders`.
 * Key: orderID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Order extends EntityBase {
  declare orderID: number;  // @generated
  declare customerID: string;  // @generated
  declare employeeID: number;  // @generated
  declare orderDate: Date;  // @generated
  declare requiredDate: Date;  // @generated
  declare shippedDate: Date;  // @generated
  declare freight: number;  // @generated
  declare shipName: string;  // @generated
  declare shipAddress: string;  // @generated
  declare shipCity: string;  // @generated
  declare shipRegion: string;  // @generated
  declare shipPostalCode: string;  // @generated
  declare shipCountry: string;  // @generated
  declare rowVersion: number;  // @generated
  declare customer: Customer;  // @generated
  declare employee: Employee;  // @generated
  declare internationalOrder: InternationalOrder;  // @generated
  declare orderDetails: RelationArray<OrderDetail>;  // @generated
}
