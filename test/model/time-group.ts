// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated
import type { TimeLimit } from './time-limit'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

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
