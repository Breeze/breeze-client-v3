// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated
import type { UserRole } from './user-role'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

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
