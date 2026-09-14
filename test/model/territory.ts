// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { EmployeeTerritory } from './employee-territory'; // @generated
import type { Region } from './region'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

/**
 * Territory:#Foo - the entity type, queried as `Territories`.
 * Key: territoryID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Territory extends EntityBase {
  declare territoryID: number;  // @generated
  declare territoryDescription: string;  // @generated
  declare regionID: number;  // @generated
  declare rowVersion: number;  // @generated
  declare employeeTerritories: RelationArray<EmployeeTerritory>;  // @generated
  declare region: Region;  // @generated
}
