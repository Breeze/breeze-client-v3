// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

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
