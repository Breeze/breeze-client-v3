// @generated-by generate-entity-classes v1.1.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import type { TimeLimit } from './time-limit'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated
import { EntityBase } from 'breeze-client'; // @generated

/**
 * TimeGroup:#Foo - the entity type, queried as `TimeGroups`.
 * Key: id.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class TimeGroup extends EntityBase {
  declare id: number;  // @generated
  declare comment: string;  // @generated
  declare timeLimits: RelationArray<TimeLimit>;  // @generated
}
