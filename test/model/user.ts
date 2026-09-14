// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import type { RelationArray } from '../../src/breeze'; // @generated
import { EntityBase } from './entity-base'; // @generated
import type { UserRole } from './user-role'; // @generated

/**
 * User:#Foo - the entity type, queried as `Users`.
 * Key: id.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class User extends EntityBase {
  declare id: number;  // @generated
  declare userName: string;  // @generated
  declare userPassword: string;  // @generated
  declare firstName: string;  // @generated
  declare lastName: string;  // @generated
  declare email: string;  // @generated
  declare rowVersion: number;  // @generated
  declare createdBy: string;  // @generated
  declare createdByUserId: number;  // @generated
  declare createdDate: Date;  // @generated
  declare modifiedBy: string;  // @generated
  declare modifiedByUserId: number;  // @generated
  declare modifiedDate: Date;  // @generated
  declare userRoles: RelationArray<UserRole>;  // @generated
}
