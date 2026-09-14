// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import { EntityBase } from './entity-base'; // @generated

/**
 * Comment:#Foo - the entity type, queried as `Comments`.
 * Key: createdOn, seqNum.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Comment extends EntityBase {
  declare createdOn: Date;  // @generated
  declare seqNum: number;  // @generated
  declare comment1: string;  // @generated
}
