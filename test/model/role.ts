// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import type { RelationArray } from '../../src/breeze'; // @generated
import { EntityBase } from './entity-base'; // @generated
import type { UserRole } from './user-role'; // @generated

/**
 * Role:#Foo - the entity type, queried as `Roles`.
 * Key: id.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Role extends EntityBase {
  declare id: number;  // @generated
  declare name: string;  // @generated
  declare description: string;  // @generated
  declare ts: string;  // @generated
  declare roleType: string;  // @generated
  declare userRoles: RelationArray<UserRole>;  // @generated
}
