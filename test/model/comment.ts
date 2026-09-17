// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

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
