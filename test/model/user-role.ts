// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated
import type { Role } from './role'; // @generated
import type { User } from './user'; // @generated

/**
 * UserRole:#Foo - the entity type, queried as `UserRoles`.
 * Key: iD.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class UserRole extends EntityBase {
  declare iD: number;  // @generated
  declare userId: number;  // @generated
  declare roleId: number;  // @generated
  declare role: Role;  // @generated
  declare user: User;  // @generated
}
