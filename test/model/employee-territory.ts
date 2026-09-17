// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated
import type { Employee } from './employee'; // @generated
import type { Territory } from './territory'; // @generated

/**
 * EmployeeTerritory:#Foo - the entity type, queried as `EmployeeTerritories`.
 * Key: employeeID, territoryID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class EmployeeTerritory extends EntityBase {
  declare employeeID: number;  // @generated
  declare territoryID: number;  // @generated
  declare employee: Employee;  // @generated
  declare territory: Territory;  // @generated
}
