// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated
import type { TimeGroup } from './time-group'; // @generated

/**
 * TimeLimit:#Foo - the entity type, queried as `TimeLimits`.
 * Key: id.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class TimeLimit extends EntityBase {
  declare id: number;  // @generated
  declare maxTime: string;  // @generated
  declare minTime: string;  // @generated
  declare timeGroupId: number;  // @generated
  declare timeGroup: TimeGroup;  // @generated
}
