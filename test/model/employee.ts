// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { EmployeeTerritory } from './employee-territory'; // @generated
import type { Order } from './order'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

/**
 * Employee:#Foo - the entity type, queried as `Employees`.
 * Key: employeeID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Employee extends EntityBase {
  declare employeeID: number;  // @generated
  declare lastName: string;  // @generated
  declare firstName: string;  // @generated
  declare title: string;  // @generated
  declare titleOfCourtesy: string;  // @generated
  declare birthDate: Date;  // @generated
  declare hireDate: Date;  // @generated
  declare address: string;  // @generated
  declare city: string;  // @generated
  declare region: string;  // @generated
  declare postalCode: string;  // @generated
  declare country: string;  // @generated
  declare homePhone: string;  // @generated
  declare extension: string;  // @generated
  declare photo: string;  // @generated
  declare notes: string;  // @generated
  declare photoPath: string;  // @generated
  declare reportsToEmployeeID: number;  // @generated
  declare rowVersion: number;  // @generated
  declare fullName: string;  // @generated
  declare directReports: RelationArray<Employee>;  // @generated
  declare employeeTerritories: RelationArray<EmployeeTerritory>;  // @generated
  declare manager: Employee;  // @generated
  declare orders: RelationArray<Order>;  // @generated
}
