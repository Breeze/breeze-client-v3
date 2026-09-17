// @generated-by generate-entity-classes v1.0.0
// Properties of this type in the server metadata are written here and rewritten on
// every run. Everything else in this file is yours and is never touched.
// To keep one of those too, see the manual markers in ./README.md.

import { EntityBase } from './entity-base'; // @generated

/**
 * PreviousEmployee:#Foo - the entity type, queried as `PreviousEmployees`.
 * Key: employeeID.
 *
 * Methods, getters and unmapped properties added below survive a regeneration; see
 * ./README.md.
 */
export class PreviousEmployee extends EntityBase {
  declare employeeID: number;  // @generated
  declare lastName: string;  // @generated
  declare firstName: string;  // @generated
  declare title: string;  // @generated
  declare titleOfCourtesy: string;  // @generated
  declare birthDate: Date;  // @generated
  declare hireDate: Date;  // @generated
  declare address: string;  // @generated
  declare city: string;  // @generated
  declare region: string;  // @generated
  declare postalCode: string;  // @generated
  declare country: string;  // @generated
  declare homePhone: string;  // @generated
  declare extension: string;  // @generated
  declare photo: string;  // @generated
  declare notes: string;  // @generated
  declare photoPath: string;  // @generated
  declare rowVersion: number;  // @generated
}
