// @generated-by generate-entity-classes v1.0.0
// This whole file is generated. Put hand-written code in a separate module.
//
// registerModelClasses attaches these classes to one MetadataStore. Breeze binds a class to a
// single store - registering the same class in a second store throws - so call it once, on the
// store the managers under test share.
import type { MetadataStore } from 'breeze-client';
export { ComplexObjectBase, EntityBase } from './entity-base';
import { Category } from './category';
import { Comment } from './comment';
import { Customer } from './customer';
import { Employee } from './employee';
import { EmployeeTerritory } from './employee-territory';
import { Geospatial } from './geospatial';
import { InternationalOrder } from './international-order';
import { Location } from './location';
import { Order } from './order';
import { OrderDetail } from './order-detail';
import { PreviousEmployee } from './previous-employee';
import { Product } from './product';
import { Region } from './region';
import { Role } from './role';
import { Supplier } from './supplier';
import { Territory } from './territory';
import { TimeGroup } from './time-group';
import { TimeLimit } from './time-limit';
import { UnusualDate } from './unusual-date';
import { User } from './user';
import { UserRole } from './user-role';

export {
  Category,
  Comment,
  Customer,
  Employee,
  EmployeeTerritory,
  Geospatial,
  InternationalOrder,
  Location,
  Order,
  OrderDetail,
  PreviousEmployee,
  Product,
  Region,
  Role,
  Supplier,
  Territory,
  TimeGroup,
  TimeLimit,
  UnusualDate,
  User,
  UserRole,
};

/** Every generated class, by the short name Breeze knows it as. */
export const modelClasses = {
  Category,
  Comment,
  Customer,
  Employee,
  EmployeeTerritory,
  Geospatial,
  InternationalOrder,
  Location,
  Order,
  OrderDetail,
  PreviousEmployee,
  Product,
  Region,
  Role,
  Supplier,
  Territory,
  TimeGroup,
  TimeLimit,
  UnusualDate,
  User,
  UserRole,
};

/** Register all of them with `metadataStore`. Safe to call twice with the same store. */
export function registerModelClasses(metadataStore: MetadataStore) {
  for (const [name, ctor] of Object.entries(modelClasses)) {
    metadataStore.registerEntityTypeCtor(name, ctor);
  }
}
