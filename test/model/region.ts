// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import type { RelationArray } from '../../src/breeze'; // @generated
import { EntityBase } from './entity-base'; // @generated
import type { Territory } from './territory'; // @generated

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
