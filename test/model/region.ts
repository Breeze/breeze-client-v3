// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated
import type { Territory } from './territory'; // @generated
import type { RelationArray } from 'breeze-client'; // @generated

/**
 * Region:#Foo - the entity type, queried as `Regions`.
 * Key: regionID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class Region extends EntityBase {
  declare regionID: number;  // @generated
  declare regionDescription: string;  // @generated
  declare rowVersion: number;  // @generated
  declare territories: RelationArray<Territory>;  // @generated
}
