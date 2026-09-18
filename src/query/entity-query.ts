import { core, Callback, ErrorCallback, arrayFlatMap, stringStartsWith } from '../core/core.js';
import { assertParam } from '../core/assert-param.js';
import { DataType } from '../metadata/data-type.js';
import { EntityAspect, Entity } from '../entity/entity-aspect.js';
import type { QueriedAs } from '../entity/entity-aspect.js';
import { EntityKey } from '../entity/entity-key.js';
import { BreezeEnum } from '../core/enum.js';
import { DataService, JsonResultsAdapter } from '../metadata/data-service.js';
import { EntityManager, QueryResult } from '../manager/entity-manager.js';
import { MetadataStore, EntityType, NavigationProperty, EntityProperty, entityTypeForCtor } from '../metadata/entity-metadata.js';
import { QueryOptions, MergeStrategy, FetchStrategy } from './query-options.js';
import { Predicate } from './predicate.js';
import type { CollectionElement, CollectionPath, FilterOpFor, FilterValueFor, FunctionExpressionPath, WhereObject, NavigationPath, OrderByPath, PropertyPath, PropertyValue, QuantifierOp, SelectPath } from './property-path.js';

export interface RecursiveArray<T> {
  [i: number]: T | RecursiveArray<T>;
}


export interface EntityQueryJsonContext {
  entityType?: EntityType;
  propertyPathFn?: Function; // TODO
  toNameOnServer?: boolean;
}
/**
An EntityQuery instance is used to query entities either from a remote datasource or from a local {@link EntityManager}.

EntityQueries are immutable - this means that all EntityQuery methods that return an EntityQuery actually create a new EntityQuery.  This means that
EntityQueries can be 'modified' without affecting any current instances.
*/
export class EntityQuery<T = any> {
  /** @hidden @internal */
  declare _$typeName: string; // actually placed on prototype
  // top = this.take; // TODO: consider
  /** The resource name used by this query. __Read Only__ */
  declare resourceName?: string;
  /** The {@link EntityType} that is associated with the 'from' clause ( resourceName) of the query.  This is only guaranteed to be be set AFTER the query
  has been executed because it depends on the {@link MetadataStore} associated with the {@link EntityManager} that the query was executed against.
  This value may be null if the entityType cannot be associated with a resourceName. __Read Only__ */
  declare fromEntityType?: EntityType;
  /** The 'where' {@link Predicate} used by this query. __Read Only__ */
  declare wherePredicate?: Predicate;
  /** The `OrderByClause` used by this query. __Read Only__ */
  declare orderByClause?: OrderByClause;
  /** The `ExpandClause` used by this query. __Read Only__ */
  declare expandClause?: ExpandClause;
  /** The `SelectClause` used by this query. __Read Only__ */
  declare selectClause?: SelectClause;
  /** The number of entities to 'skip' for this query. __Read Only__ */
  declare skipCount?: number;
  /** The number of entities to 'take' for this query. __Read Only__ */
  declare takeCount?: number;
  /** Any additional parameters that were added to the query via the 'withParameters' method. __Read Only__ */
  declare parameters: Object;
  /** Whether an inline count is returned for this query. __Read Only__ */
  declare inlineCountEnabled: boolean;
  /** Whether entity tracking has been disabled for this query. __Read Only__ */
  declare noTrackingEnabled: boolean;
  /** Whether to send query as the body of a POST request.  (Server needs to accomodate POST). __Read Only__ */
  declare usePostEnabled: boolean;
  /** The {@link QueryOptions} for this query. __Read Only__  */
  // default is to get queryOptions and dataService from the entityManager.
  declare queryOptions?: QueryOptions;
  /** The {@link DataService} for this query. __Read Only__  */
  declare dataService?: DataService;
  /** The {@link EntityManager} for this query. This may be null and can be set via the 'using' method.  */
  declare entityManager?: EntityManager;
  /**  The entityType that will be returned by this query. 
  This property will only be set if the 'toType' method was called. __Read Only__ */
  declare resultEntityType: EntityType | string;
  /** Whether the query's property paths are the server's names, sent as written. Set by {@link EntityQuery.useNameOnServer}. __Read Only__ */
  declare usesNameOnServer?: boolean;

  /** Constructor. Most queries start from the static {@link EntityQuery.from} instead, which takes a
  registered entity class and so gives a typed query:
  ```ts
  const query = EntityQuery.from(Customer);   // EntityQuery<Customer>
  ```

  When a constructor is needed, supply the type argument. As with a type argument on
  `EntityQuery.from(resourceName)`, nothing checks it against the resource name:
  ```ts
  const query = new EntityQuery<Customer>("Customers");
  ```

  Usually this constructor will be followed by calls to filtering, ordering or selection methods
  ```ts
  const query = new EntityQuery<Customer>("Customers")
    .where("companyName", "startsWith", "C")
    .orderBy("region");
  ```
  @param resourceName - either a resource name or a serialized EntityQuery ( created by {@link EntityQuery.toJSON})
  */
  constructor(resourceName?: string | Object) {
    if (resourceName != null && (typeof resourceName !== 'string')) {
      return fromJSON(this, resourceName);
    }
    // The cast holds for test/tsconfig.json, which checks src/ again with strictNullChecks off;
    // without it the guard above narrows to `string | Object` rather than `string | undefined`.
    this.resourceName = resourceName as string;
    this.fromEntityType = undefined;
    this.wherePredicate = undefined;
    this.orderByClause = undefined;
    this.selectClause = undefined;
    this.skipCount = undefined;
    this.takeCount = undefined;
    this.expandClause = undefined;
    this.parameters = {};
    this.inlineCountEnabled = false;
    this.noTrackingEnabled = false;
    this.usePostEnabled = false;
    // default is to get queryOptions and dataService from the entityManager.
    // this.queryOptions = new QueryOptions();
    // this.dataService = new DataService();
    this.entityManager = undefined;

  }


  /**
  Specifies the resource to query for this EntityQuery.
  ```ts
  const query = new EntityQuery()
    .from("Customers");
  ```

  is the same as
  ```ts
  const query = new EntityQuery("Customers");
  ```

  For a typed query, use the static `EntityQuery.from(Customer)` instead.
  @param resourceName - The resource to query.
  */
  from(resourceName: string) {
    // TODO: think about allowing entityType as well
    assertParam(resourceName, "resourceName").isString().check();
    return clone(this, "resourceName", resourceName);
  }

  /**
  Creates a 'base' entityQuery, either for a registered entity class or for a resource name.

  Given a class, the resource name comes from the metadata and the query carries the type, so the
  results are typed:
  ```ts
  const query = EntityQuery.from(Customer);            // EntityQuery<Customer>
  const custs = (await query.using(em).execute()).results;   // Customer[]
  ```

  The class must be registered with {@link MetadataStore.registerEntityTypeCtor}; that is what
  tells Breeze which type it stands for, and an unregistered class throws.

  A resource name may be given instead; see the other signature.
  @param entityCtor - A constructor registered for the EntityType to query.
  */
  static from<U extends Entity>(entityCtor: new () => U): EntityQuery<U>;
  /**
  Creates a 'base' entityQuery for the specified resource name. Prefer passing a registered entity
  class, as in `EntityQuery.from(Customer)`, which gives a typed query.

  Given a resource name, the query is untyped, as it always was:
  ```ts
  const query = EntityQuery.from("Customers");
  ```

  is the same as
  ```ts
  const query = new EntityQuery("Customers");
  ```

  A type argument may be supplied with a resource name, for a projection or a named server query
  that no entity class describes. **Nothing checks it against the resource** - it is an assertion,
  not a guarantee, and `EntityQuery.from<Customer>("Orders")` compiles:
  ```ts
  const query = EntityQuery.from<CustomerDto>("CompanyNamesAndIds");
  ```

  `U` is the caller's claim about what the resource returns; nothing checks it against the name.
  It defaults to `any`, so `from("Customers")` behaves exactly as it always has.
  @param resourceName - The resource to query.
  */
  static from<U = any>(resourceName: string): EntityQuery<U>;
  static from(arg: string | (new () => Entity)): EntityQuery<any> {
    if (typeof arg === 'function') {
      const entityType = entityTypeForCtor(arg);
      if (!entityType.defaultResourceName) {
        throw new Error(`'${entityType.name}' has no defaultResourceName, so a query cannot be built from the constructor. ` +
          `Use EntityQuery.from(resourceName).toType(...) instead, or call metadataStore.setEntityTypeForResourceName.`);
      }
      return new EntityQuery(entityType.defaultResourceName);
    }
    assertParam(arg, "resourceName").isString().check();
    return new EntityQuery(arg);
  }

  /**
  Specifies the top level type this query will return, as a registered constructor. The query then
  carries that type, so its results are typed - and because the constructor is resolved through
  metadata, this is *checked*, unlike a type argument on {@link EntityQuery.from}:
  ```ts
  const query = EntityQuery.from("CustomersAndOrders").toType(Customer);   // EntityQuery<Customer>
  ```
  @param entityCtor - A constructor registered for the EntityType this query will return.
  @summary If the json result consists of more than a simple entity or array of entities, consider using a {@link JsonResultsAdapter} instead.
  */
  toType<U extends Entity>(entityCtor: new () => U): EntityQuery<U>;
  /**
  Specifies the top level EntityType that this query will return.  Only needed when a query returns a json result that does not include type information,
  or when using a resource name that is not associated to an EntityType.
  ```ts
  const query = EntityQuery.from("MyCustomMethod")
    .toType("Customer");
  ```

  Passing the registered class instead, as in `toType(Customer)`, also types the query.
  @param entityType - The top level EntityType that this query will return.
  @summary If the json result consists of more than a simple entity or array of entities, consider using a {@link JsonResultsAdapter} instead.
  */
  toType(entityType: string | EntityType): EntityQuery<any>;
  toType(entityType: string | EntityType | (new () => Entity)): EntityQuery<any> {
    // Naming the type is what `toType` is for, so a registered constructor names it *and* types
    // the query - and unlike a type argument on `from(resourceName)`, this one is checked against
    // the metadata.
    if (typeof entityType === 'function') {
      entityType = entityTypeForCtor(entityType);
    }
    assertParam(entityType, "entityType").isString().or().isInstanceOf(EntityType).check();
    return clone(this, "resultEntityType", entityType) as EntityQuery<any>;
  }


  // The checked forms come first, so they are tried first. They engage only when the query has a
  // concrete entity type. EntityQuery<T = any> means many queries do not, and for those
  // PropertyPath<T> is plain `string` and these are no narrower than what was always here.
  where(collection: CollectionPath<T>, quantifier: QuantifierOp | FilterQueryOp,
    predicate: Predicate): EntityQuery<T>;
  where(collection: CollectionPath<T>, quantifier: QuantifierOp | FilterQueryOp,
    property: string, quantifier2: QuantifierOp | FilterQueryOp,
    predicate: Predicate): EntityQuery<T>;  // nested any/all over a prebuilt Predicate

  // The object form, checked against T. WhereObject<T> is `object` for an untyped query, so this
  // is exactly the `where(predicate: Object)` overload it replaces wherever T is not concrete.
  where(predicate: WhereObject<T>): EntityQuery<T>;
  where(predicate?: Predicate): EntityQuery<T>;

  // Escapes, for what cannot be checked: a property path or an operator that is only known at
  // run time. Each one takes the unknowable part as a type parameter and demands that it really
  // be `string` - `string extends P` is true for a variable and false for a literal - so these
  // accept a computed path while never rescuing a literal the checked forms have rejected.
  where<O extends string>(property: PropertyPath<T>,
    operator: string extends O ? O : never, value: any): EntityQuery<T>;
  where<P extends string>(property: P extends FunctionExpressionPath ? P : (string extends P ? P : never),
    operator: string | FilterQueryOp, value: any): EntityQuery<T>;
  where<P extends string>(collection: string extends P ? P : never,
    quantifier: string | FilterQueryOp, property: string,
    operator: string | FilterQueryOp, value: any): EntityQuery<T>;  // any/all
  where<P2 extends string>(collection: CollectionPath<T>, quantifier: string | FilterQueryOp,
    property: string extends P2 ? P2 : never,
    operator: string | FilterQueryOp, value: any): EntityQuery<T>;  // any/all
  where<O2 extends string>(collection: CollectionPath<T>, quantifier: string | FilterQueryOp,
    property: PropertyPath<CollectionElement<T, CollectionPath<T>>> | string,
    operator: string extends O2 ? O2 : never, value: any): EntityQuery<T>;  // any/all
  where(property: string, filterop: string, property2: string, filterop2: string, property3: string, filterop3: string, value: any): EntityQuery<T>;  // nested any/all
  where(anArray: RecursiveArray<string | number | FilterQueryOp | Predicate>): EntityQuery<T>;
  // Last on purpose, not by accident. When no overload matches, TypeScript reports the error from
  // the *last* one - so with the escapes last, a misspelled path was reported as 'not assignable to
  // never', which says nothing. With the checked forms last it names the type that was expected.
  // Resolution is unaffected: the escapes reject a literal, so a literal still lands here.
  where<P extends PropertyPath<T>, O extends FilterOpFor<PropertyValue<T, P>>>(
    property: P, operator: O, value: FilterValueFor<T, PropertyValue<T, P>, O>): EntityQuery<T>;
  where<P extends CollectionPath<T>,
    P2 extends PropertyPath<CollectionElement<T, P>>,
    O2 extends FilterOpFor<PropertyValue<CollectionElement<T, P>, P2>>>(
    collection: P, quantifier: QuantifierOp, property: P2, operator: O2,
    value: FilterValueFor<CollectionElement<T, P>, PropertyValue<CollectionElement<T, P>, P2>, O2>): EntityQuery<T>;
  /**
  Returns a new query with an added filter criteria; Can be called multiple times which means to 'and' with any existing
  Predicate or can be called with null to clear all predicates.
  ```ts
  const query = EntityQuery.from(Customer)
      .where("companyName", "startsWith", "C");
  ```

  or in object form
  ```ts
  const query = EntityQuery.from(Customer)
      .where({ companyName: { startsWith: "C" } });
  ```

  This can also be expressed using an explicit {@link FilterQueryOp} (the operator is then not checked against the property's type) as
  ```ts
  const query = EntityQuery.from(Customer)
      .where("companyName", FilterQueryOp.StartsWith, "C");
  ```

  or a preconstructed {@link Predicate} may be used
  ```ts
  const p = Predicate.for(Customer);
  const query = EntityQuery.from(Customer).where(p("companyName", "startsWith", "C"));
  ```

  Predicates are often useful when you want to combine multiple conditions in a single filter, such as
  ```ts
  const pred = p("companyName", "startsWith", "C").and(p("region", "eq", null));
  const query = EntityQuery.from(Customer)
      .where(pred);
  ```

  More complicated queries can make use of nested property paths
  ```ts
  const query = EntityQuery.from(Product)
      .where("category.categoryName", "startsWith", "S");
  ```

  or query functions - A list of valid functions can be found within the {@link Predicate} documentation.

  ```ts
  const query = EntityQuery.from(Customer)
      .where("toLower(companyName)", "startsWith", "c");
  ```

  or to be even more baroque
  ```ts
  const query = EntityQuery.from(Customer)
      .where("toUpper(substring(companyName, 1, 2))", FilterQueryOp.Equals, "OM");
  ```
  @param predicate -  Can be either
    - a single {@link Predicate}

    - the parameters to create a 'simple' Predicate
    - -  a property name, a property path with '.' as path seperators or a property expression {String}
    - -  an operator - {@link FilterQueryOp} or it's string representation. Case is ignored
    when if a string is provided and any string that matches one of the FilterQueryOp aliases will be accepted.
    - -  a value {Object} - This will be treated as either a property expression or a literal depending on context.  
    In general, if the value can be interpreted as a property expression it will be, otherwise it will be treated as a literal.
    In most cases this works well, but you can also force the interpretation by making the value argument itself an object 
    with a 'value' property and an 'isLiteral' property set to either true or false.
    Breeze also tries to infer the dataType of any literal based on context, if this fails you can force this inference by making the value argument 
    an object with a 'value' property and a 'dataType'property set to one of the DataType enumeration instances.

    - a null or undefined ( this causes any existing where clause to be removed)
  */
  where(...args: any[]) {
    let wherePredicate: Predicate | undefined;
    if (args.length > 0 && args[0] != null) {
      wherePredicate = (Predicate.create as (...a: any[]) => Predicate)(...args);
      if (this.fromEntityType) wherePredicate._validate(this.fromEntityType);
      if (this.wherePredicate) {
        wherePredicate = this.wherePredicate.and(wherePredicate);
      }
    }
    return clone(this, "wherePredicate", wherePredicate);
  }


  orderBy(propertyPaths: OrderByPath<T> | OrderByPath<T>[], isDescending?: boolean): EntityQuery<T>;
  // Escapes, as on where(): a path only known at run time, and the documented comma-separated
  // list, which is let through unchecked rather than enumerated - every combination of paths is
  // not something to ask of a compiler. An array keeps the checking.
  orderBy<P extends string>(propertyPaths: P extends `${string},${string}` ? P : (string extends P ? P : never),
    isDescending?: boolean): EntityQuery<T>;
  orderBy(propertyPaths?: undefined, isDescending?: boolean): EntityQuery<T>;
  orderBy<P extends string>(propertyPaths: string extends P ? P[] : never, isDescending?: boolean): EntityQuery<T>;
  /**
  Returns a new query that orders the results of the query by property name.  By default sorting occurs is ascending order, but sorting in descending order is supported as well.
  OrderBy clauses may be chained.
  ```ts
  const query = EntityQuery.from(Customer)
     .orderBy("companyName");
  ```

  or to sort across multiple properties
  ```ts
  const query = EntityQuery.from(Customer)
     .orderBy(["region", "companyName"]);
  ```

  A comma-separated string, `"region, companyName"`, is also accepted, but its paths are not checked.

  Nested property paths are also supported
  ```ts
  const query = EntityQuery.from(Product)
     .orderBy("category.categoryName");
  ```

  Sorting in descending order is supported via the addition of ' desc' to the end of any property path.
  ```ts
  const query = EntityQuery.from(Customer)
     .orderBy("companyName desc");
  ```

  or
  ```ts
  const query = EntityQuery.from(Customer)
     .orderBy(["region desc", "companyName desc"]);
  ```
  @param propertyPaths - A comma-separated (',') string of property paths or an array of property paths.
  Each property path can optionally end with " desc" to force a descending sort order. If 'propertyPaths' is either null or omitted then all ordering is removed.
  @param isDescending - If specified, overrides all of the embedded 'desc' tags in the previously specified property paths.
  */
  orderBy(propertyPaths?: string | string[], isDescending?: boolean) {
    // propertyPaths: can pass in create("A.X,B") or create("A.X desc, B") or create("A.X desc,B", true])
    // isDesc parameter trumps isDesc in propertyName.
    let orderByClause = propertyPaths == null ? null : new OrderByClause(normalizePropertyPaths(propertyPaths), isDescending);
    if (this.orderByClause && orderByClause) {
      orderByClause = new OrderByClause([this.orderByClause, orderByClause]);
    }
    return clone(this, "orderByClause", orderByClause);
  }


  orderByDesc(propertyPaths: OrderByPath<T> | OrderByPath<T>[]): EntityQuery<T>;
  // The same escapes as orderBy.
  orderByDesc<P extends string>(propertyPaths: P extends `${string},${string}` ? P : (string extends P ? P : never)): EntityQuery<T>;
  orderByDesc<P extends string>(propertyPaths: string extends P ? P[] : never): EntityQuery<T>;
  /**
  Returns a new query that orders the results of the query by property name in descending order.
  ```ts
  const query = EntityQuery.from(Customer)
     .orderByDesc("companyName");
  ```

  or to sort across multiple properties
  ```ts
  const query = EntityQuery.from(Customer)
     .orderByDesc(["region", "companyName"]);
  ```

  Nested property paths are also supported
  ```ts
  const query = EntityQuery.from(Product)
     .orderByDesc("category.categoryName");
  ```
  @param propertyPaths - A comma-separated (',') string of property paths or an array of property paths.
  If 'propertyPaths' is either null or omitted then all ordering is removed.
  */
  orderByDesc(propertyPaths: string | string[]) {
    return this.orderBy(propertyPaths as any, true);
  }

  /**
  Returns a new query that selects a list of properties from the results of the original query and returns the values of just these properties. This
  will be referred to as a projection.
  If the result of this selection "projection" contains entities, these entities will automatically be added to EntityManager's cache and will
  be made 'observable'.
  Any simple properties, i.e. strings, numbers or dates within a projection will not be cached are will NOT be made 'observable'.
  
  Simple data properties can be projected
  ```ts
  const query = EntityQuery.from(Customer)
      .where("companyName", "startsWith", "C")
      .select("companyName");
  ```

  This will return an array of objects each with a single "companyName" property of type string.
  A similar query could return a navigation property instead
  ```ts
  const query = EntityQuery.from(Customer)
     .where("companyName", "startsWith", "C")
     .select("orders");
  ```

  where the result would be an array of objects each with a single "orders" property that would itself be an array of "Order" entities.
  Composite projections are also possible:
  ```ts
  const query = EntityQuery.from(Customer)
     .where("companyName", "startsWith", "C")
     .select("companyName, orders");
  ```

  As well as projections involving nested property paths
  ```ts
  const query = EntityQuery.from(Order)
     .where("customer.companyName", "startsWith", "C")
     .select("customer.companyName, customer, orderDate");
  ```

  The projected query is an `EntityQuery<any>`: its results are no longer entities of the queried type.
  @param propertyPaths - A comma-separated (',') string of property paths or an array of property paths.
  If 'propertyPaths' is either null or omitted then any existing projection on the query is removed.
  */
  select(propertyPaths: SelectPath<T> | SelectPath<T>[]): EntityQuery<any>;
  // The same escapes as orderBy: a path only known at run time, the comma-separated list, and
  // undefined to remove the projection.
  select<P extends string>(propertyPaths: P extends `${string},${string}` ? P : (string extends P ? P : never)): EntityQuery<any>;
  select(propertyPaths?: undefined): EntityQuery<any>;
  select<P extends string>(propertyPaths: string extends P ? P[] : never): EntityQuery<any>;
  select(propertyPaths?: string | string[]): EntityQuery<any> {
    let selectClause = propertyPaths == null ? null : new SelectClause(normalizePropertyPaths(propertyPaths));
    // A projection no longer returns the entity type, so the type parameter is dropped rather
    // than carried forward as something the results will not be.
    return clone(this, "selectClause", selectClause) as EntityQuery<any>;
  }

  /**
  Returns a new query that skips the specified number of entities when returning results.
  Any existing 'skip' can be cleared by calling 'skip' with no arguments.
  ```ts
  const query = EntityQuery.from(Customer)
    .where("companyName", "startsWith", "C")
    .skip(5);
  ```
  @param count - The number of entities to skip over. If omitted or null any existing skip count on the query is removed.
  */
  skip(count?: number) {
    assertParam(count, "count").isOptional().isNumber().check();
    return clone(this, "skipCount", (count == null) ? null : count);
  }

  /**
  Returns a new query that returns only the specified number of entities when returning results. - Same as 'take'.
  Any existing 'top' can be cleared by calling 'top' with no arguments.
  ```ts
  const query = EntityQuery.from(Customer)
     .top(5);
  ```
  @param count - The number of entities to return.
  If 'count' is either null or omitted then any existing 'top' count on the query is removed.
  */
  top(count?: number) {
    return this.take(count);
  }

  /**
  Returns a new query that returns only the specified number of entities when returning results - Same as 'top'.
  Any existing take can be cleared by calling take with no arguments.
  ```ts
  const query = EntityQuery.from(Customer)
     .take(5);
  ```
  @param count - The number of entities to return.
  If 'count' is either null or omitted then any existing 'take' count on the query is removed.
  */
  take(count?: number) {
    assertParam(count, "count").isOptional().isNumber().check();
    return clone(this, "takeCount", (count == null) ? null : count);
  }

  expand(propertyPaths: NavigationPath<T> | NavigationPath<T>[]): EntityQuery<T>;
  expand<P extends string>(propertyPaths: P extends `${string},${string}` ? P : (string extends P ? P : never)): EntityQuery<T>;
  expand<P extends string>(propertyPaths: string extends P ? P[] : never): EntityQuery<T>;
  expand(propertyPaths?: undefined): EntityQuery<T>;
  /**
  Returns a new query that will return related entities nested within its results. The expand method allows you to identify related entities, via navigation property
  names such that a graph of entities may be retrieved with a single request. Any filtering occurs before the results are 'expanded'.
  ```ts
  const query = EntityQuery.from(Customer)
     .where("companyName", "startsWith", "C")
     .expand("orders");
  ```

  will return the filtered customers each with its "orders" properties fully resolved.
  Multiple paths may be specified in an array
  ```ts
  const query = EntityQuery.from(Order)
     .expand(["customer", "employee"]);
  ```

  and nested property paths my be specified as well
  ```ts
  const query = EntityQuery.from(Order)
     .expand(["customer", "orderDetails", "orderDetails.product"]);
  ```

  The paths may also be separated by a ',' in a single string, `"customer, employee"`, but those paths are not checked.
  @param propertyPaths - A comma-separated list of navigation property names or an array of navigation property names. Each Navigation Property name can be followed
  by a '.' and another navigation property name to enable identifying a multi-level relationship.
  If 'propertyPaths' is either null or omitted then any existing 'expand' clause on the query is removed.
  */
  expand(propertyPaths?: string | string[]) {
    let expandClause = propertyPaths == null ? null : new ExpandClause(normalizePropertyPaths(propertyPaths));
    return clone(this, "expandClause", expandClause);
  }

  /**
  Returns a new query that includes a collection of parameters to pass to the server.
  ```ts
  const query = EntityQuery.from("EmployeesFilteredByCountryAndBirthdate")
     .toType(Employee)
     .withParameters({ birthDate: "1/1/1960", country: "USA" });
  ```
   
  will call the 'EmployeesFilteredByCountryAndBirthdate' method on the server and pass in 2 parameters. This
  query will be uri encoded as
  ```ts
  {serviceApi}/EmployeesFilteredByCountryAndBirthdate?birthDate=1%2F1%2F1960&country=USA
  ```

  Parameters may also be mixed in with other query criteria.
  ```ts
  const query = EntityQuery.from("EmployeesFilteredByCountryAndBirthdate")
     .toType(Employee)
     .withParameters({ birthDate: "1/1/1960", country: "USA" })
     .where("lastName", "startsWith", "S")
     .orderBy("birthDate");
  ```
  @param parameters - A parameters object where the keys are the parameter names and the values are the parameter values.
  */
  withParameters(parameters: Object) {
    assertParam(parameters, "parameters").isObject().check();
    return clone(this, "parameters", parameters);
  }

  /**
  Returns a query with the `inlineCount` capability either enabled or disabled.  With `inlineCount` enabled, an additional 'inlineCount' property
  will be returned with the query results that will contain the number of entities that would have been returned by this
  query with only the 'where'/'filter' clauses applied, i.e. without any 'skip'/'take' operators applied. For local queries this clause is ignored.
  ```ts
  const query = EntityQuery.from(Customer)
     .take(20)
     .orderBy("companyName")
     .inlineCount(true);
  ```

  will return the first 20 customers as well as a count of _all_ of the customers in the remote store.
  @param enabled - (default = true) Whether or not inlineCount capability should be enabled. If this parameter is omitted, true is assumed.
  */
  inlineCount(enabled?: boolean) {
    assertParam(enabled, "enabled").isBoolean().isOptional().check();
    enabled = (enabled === undefined) ? true : !!enabled;
    return clone(this, "inlineCountEnabled", enabled);
  }

  /**
  Returns a query whose property paths are the server's names rather than the client's, so Breeze
  sends them as written instead of translating them with the `MetadataStore`'s naming convention.
  ```ts
  EntityQuery.from('Customers').where('CompanyName', 'startsWith', 'A').useNameOnServer();
  ```
  The query is built from a resource name because a typed query, `EntityQuery.from(Customer)`,
  checks its paths against the client's names and would reject `'CompanyName'`.
  Only the query sent to the server is affected: run against the cache, a query works on the
  client's objects and needs the client's names.
  @param usesNameOnServer - (default = true)
  */
  useNameOnServer(usesNameOnServer?: boolean) {
    assertParam(usesNameOnServer, "usesNameOnServer").isBoolean().isOptional().check();
    usesNameOnServer = (usesNameOnServer === undefined) ? true : !!usesNameOnServer;
    return clone(this, "usesNameOnServer", usesNameOnServer);
  }

  /**
  Returns a query with the `noTracking` capability either enabled or disabled.  With `noTracking` enabled, the results of this query
  will not be coerced into entities but will instead look like raw javascript projections. i.e. simple javascript objects.
  ```ts
  const query = EntityQuery.from(Customer)
      .take(20)
      .orderBy("companyName")
      .noTracking(true);
  ```
  @param enabled - (default = true) Whether or not the noTracking capability should be enabled. If this parameter is omitted, true is assumed.
  */
  noTracking(enabled?: boolean) {
    assertParam(enabled, "enabled").isBoolean().isOptional().check();
    enabled = (enabled === undefined) ? true : !!enabled;
    return clone(this, "noTrackingEnabled", enabled);
  }

  /**
  Returns a query with the `usePost` capability either enabled or disabled.  With `usePost` enabled, the query is sent
  as a POST request (instead of GET) and the query expression will be sent as JSON in the body of the post.
  Note that the server must be able to parse the body of the request; otherwise the query expression will be ignored.
  ```ts
  const query = EntityQuery.from(Order)
      .where("freight", "gt", 100)
      .usePost(true);
  ```
  results in a POST request to `{host}/{path}/Orders`
  with body `{"where": {"Freight":{"gt":100}}}`
  @param enabled - (default = true) Whether or not usePost should be enabled. If this parameter is omitted, true is assumed.
  */
  usePost(enabled?: boolean) {
    assertParam(enabled, "enabled").isBoolean().isOptional().check();
    enabled = (enabled === undefined) ? true : !!enabled;
    return clone(this, "usePostEnabled", enabled);
  }

  using(obj: EntityManager): EntityQuery<T>;
  using(obj: DataService): EntityQuery<T>;
  using(obj: JsonResultsAdapter): EntityQuery<T>;
  using(obj: QueryOptions): EntityQuery<T>;
  using(obj: MergeStrategy): EntityQuery<T>;
  using(obj: FetchStrategy): EntityQuery<T>;
  /**
  Returns a copy of this EntityQuery with the specified {@link EntityManager}, {@link DataService},
  {@link JsonResultsAdapter}, {@link MergeStrategy} or {@link FetchStrategy} applied.
  ```ts
  // 'using' can be used to return a new query with a specified EntityManager.
  const em = new EntityManager(serviceName);
  const query = EntityQuery.from(Order)
    .using(em);
  ```

  or with a specified {@link MergeStrategy}
  ```ts
  const query = EntityQuery.from(Order)
    .using(MergeStrategy.PreserveChanges);
  ```

  or with a specified {@link FetchStrategy}
  ```ts
  const query = EntityQuery.from(Order)
    .using(FetchStrategy.FromLocalCache);
  ```
  @param obj - The object to update in creating a new EntityQuery from an existing one.
  */
  using(obj: any) {
    if (!obj) return this;
    let eq = clone(this);
    processUsing(eq, {
      "entityManager": null,
      "dataService": null,
      "queryOptions": null,
      "fetchStrategy": (eq: EntityQuery, val: any) => {
        eq.queryOptions = (eq.queryOptions || new QueryOptions()).using(val);
      },
      "mergeStrategy": (eq: EntityQuery, val: any) => {
        eq.queryOptions = (eq.queryOptions || new QueryOptions()).using(val);
      },
      "jsonResultsAdapter": (eq: EntityQuery, val: any) => {
        eq.dataService = (eq.dataService || new DataService()).using({ jsonResultsAdapter: val });
      }
    }, obj);
    return eq;
  }

  execute(): Promise<QueryResult<T>>;
  /** @deprecated Await the returned promise instead of passing callbacks. */
  execute(callback?: Callback, errorCallback?: ErrorCallback): Promise<QueryResult<T>>;
  /**
  Executes this query.  This method requires that an EntityManager has been previously specified via the "using" method.
  
  It returns a promise:
  ```ts
  const em = new EntityManager(serviceName);
  const query = EntityQuery.from(Order).using(em);
  const data = await query.execute();   // rejects if the query fails
  const orders = data.results;          // Order[]
  ```

  The `callback` and `errorCallback` arguments are deprecated. They still work, but the
  promise is the supported form and the callbacks will be removed in a future major version.

  This method is the same as calling the EntityManager 'executeQuery' method.
  ```ts
  const em = new EntityManager(serviceName);
  const query = EntityQuery.from(Order);
  const data = await em.executeQuery(query);
  const orders = data.results;          // Order[]
  ```

  @param callback - Deprecated. Function called on success.
  @param errorCallback - Deprecated. Function called on failure.
  @returns Promise
  */
  execute(callback?: Callback, errorCallback?: ErrorCallback): Promise<QueryResult<T>> {
    if (!this.entityManager) {
      throw new Error("An EntityQuery must have its EntityManager property set before calling 'execute'");
    }
    return this.entityManager.executeQuery(this, callback, errorCallback);
  }

  /**
  Executes this query against the local cache.  This method requires that an EntityManager have been previously specified via the "using" method.
  ```ts
  // assume em is an entityManager already filled with order entities;
  const query = EntityQuery.from(Order).using(em);
  const orders = query.executeLocally();   // Order[]
  ```

  Note that calling this method is the same as calling {@link EntityManager.executeQueryLocally}.
  */
  executeLocally(): T[] {
    if (!this.entityManager) {
      throw new Error("An EntityQuery must have its EntityManager property set before calling 'executeLocally'");
    }
    return this.entityManager.executeQueryLocally(this);
  }

  /**
  Executes this query against the server and returns only the number of matching entities, without
  materializing any of them. Requires an EntityManager, set via {@link EntityQuery.using}.
  ```ts
  const count = await EntityQuery.from(Order).where("freight", ">", 100).using(em).executeCount();
  ```

  It is `take(0).inlineCount(true)` and reads `inlineCount` off the result, so the server must
  support inline count.
  */
  async executeCount(): Promise<number> {
    if (!this.entityManager) {
      throw new Error("An EntityQuery must have its EntityManager property set before calling 'executeCount'");
    }
    const qr = await this.take(0).inlineCount(true).execute();
    return qr.inlineCount!;
  }

  /**
  Returns the serializable form of this query: its resource name, clauses, parameters and options,
  with client property names. `JSON.stringify` calls it, and passing the parsed JSON to the
  `EntityQuery` constructor recreates the query. The `EntityManager` and `DataService` are not
  included.
  */
  toJSON() {
    const json = this.toJSONExt() as Record<string, any>;
    // usePost is not part of the query sent to the server, so toJSONExt leaves it out;
    // it is part of the query itself, and fromJSON reads it back.
    if (this.usePostEnabled) json.usePost = true;
    return json;
  }

  /** Typically only for use when building UriBuilderAdapters.  
  @hidden @internal  
  */
  toJSONExt(context?: EntityQueryJsonContext) {
    context = context || {};
    context.entityType = context.entityType || this.fromEntityType;
    // A query written in the server's names (useNameOnServer) is sent as it is.
    if (this.usesNameOnServer) context.toNameOnServer = false;
    context.propertyPathFn = context.toNameOnServer ? context.entityType!.clientPropertyPathToServer.bind(context.entityType) : core.identity;

    let toJSONExtFn = function (v: any) {
      return v ? v.toJSONExt(context) : undefined;
    };
    return core.toJson(this, {
      "from,resourceName": null,
      "toType,resultEntityType": function (v: any) {
        // resultEntityType can be either a string or an entityType
        return v ? (typeof v === 'string' ? v : v.name) : undefined;
      },
      "where,wherePredicate": toJSONExtFn,
      "orderBy,orderByClause": toJSONExtFn,
      "select,selectClause": toJSONExtFn,
      "expand,expandClause": toJSONExtFn,
      "skip,skipCount": null,
      "take,takeCount": null,
      parameters: function (v: any) {
        return core.isEmpty(v) ? undefined : v;
      },
      "inlineCount,inlineCountEnabled": false,
      "noTracking,noTrackingEnabled": false,
      queryOptions: null
    });

  }

  static fromEntities<U extends Entity>(entity: U): EntityQuery<QueriedAs<U>>;
  static fromEntities<U extends Entity>(entities: U[]): EntityQuery<QueriedAs<U>>;
  /**
  Static method that creates an EntityQuery that will allow 'requerying' an entity or a collection of entities by primary key. This can be useful
  to force a requery of selected entities, or to restrict an existing collection of entities according to some filter.

  Works for a single entity or an array of entities of the SAME type.
  Does not work for an array of entities of different types.
  ```ts
  // assuming 'customers' is an array of 'Customer' entities retrieved earlier.
  const customersQuery = EntityQuery.fromEntities(customers);   // EntityQuery<Customer>
  ```

  The resulting query can, of course, be extended
  ```ts
  // assuming 'customers' is an array of 'Customer' entities retrieved earlier.
  const customersQuery = EntityQuery.fromEntities(customers)
    .where("region", "ne", null);
  ```

  Single entities can requeried as well.
  ```ts
  // assuming 'customer' is a 'Customer' entity retrieved earlier.
  const customerQuery = EntityQuery.fromEntities(customer);
  ```

  will create a query that will return an array containing a single customer entity.
  @param entities - The entities for which we want to create an EntityQuery.
  */
  static fromEntities(entities: Entity | Entity[]) {
    assertParam(entities, "entities").isEntity().or().isNonEmptyArray().isEntity().check();
    let ents = (Array.isArray(entities)) ? entities : [entities];

    let firstEntity = ents[0];
    let type = firstEntity.entityType;
    if (ents.some(function (e) {
      return e.entityType !== type;
    })) {
      throw new Error("All 'fromEntities' must be the same type; at least one is not of type " +
        type.name);
    }
    let q = new EntityQuery(type.defaultResourceName);
    let preds = ents.map(function (entity) {
      return buildPredicate(entity);
    });
    let pred = Predicate.or(preds);
    q = q.where(pred);
    let em = firstEntity.entityAspect.entityManager;
    if (em) {
      q = q.using(em);
    }
    return q;
  }

  /**
  Creates an EntityQuery for the specified {@link EntityKey}.
  ```ts
  const entityKey = new EntityKey(Employee, 1);
  const query = EntityQuery.fromEntityKey(entityKey);
  ```

  or
  ```ts
  // 'employee' is a previously queried employee
  const entityKey = employee.entityAspect.getKey();
  const query = EntityQuery.fromEntityKey(entityKey);
  ```
  @param entityKey - The {@link EntityKey} for which a query will be created.
  */
  static fromEntityKey(entityKey: EntityKey) {
    assertParam(entityKey, "entityKey").isInstanceOf(EntityKey).check();
    let q = new EntityQuery(entityKey.entityType.defaultResourceName);
    let pred = buildKeyPredicate(entityKey);
    q = q.where(pred).toType(entityKey.entityType);
    return q;
  }

  /**
  Creates an EntityQuery for the specified entity and {@link NavigationProperty}.
  ```ts
  // 'employee' is a previously queried employee
  const query = EntityQuery.fromEntityNavigation(employee, "orders");
  ```

  will return a query for the "orders" of the specified 'employee'. The {@link NavigationProperty}
  itself may be passed instead of its name:
  ```ts
  const ordersNavProp = employee.entityType.getNavigationProperty("orders");
  const query = EntityQuery.fromEntityNavigation(employee, ordersNavProp);
  ```
  @param entity - The Entity whose navigation property will be queried.
  @param navigationProperty - The {@link NavigationProperty} or name of the NavigationProperty to be queried.
  */
  static fromEntityNavigation = function (entity: Entity, navigationProperty: NavigationProperty | string) {
    assertParam(entity, "entity").isEntity().check();
    let navProperty = entity.entityType._checkNavProperty(navigationProperty);
    let q = new EntityQuery(navProperty.entityType.defaultResourceName);
    let pred = buildNavigationPredicate(entity, navProperty);
    if (pred == null) {
      throw new Error("Unable to create a NavigationQuery for navigationProperty: " + navProperty.name );
    }
    q = q.where(pred);
    let em = entity.entityAspect.entityManager;
    return em ? q.using(em) : q;
  };

  // protected methods
  /** @hidden @internal */
  _getFromEntityType(metadataStore: MetadataStore, throwErrorIfNotFound?: boolean) {
    // Uncomment next two lines if we make this method public.
    // assertParam(metadataStore, "metadataStore").isInstanceOf(MetadataStore).check();
    // assertParam(throwErrorIfNotFound, "throwErrorIfNotFound").isBoolean().isOptional().check();
    let entityType = this.fromEntityType;
    if (entityType) return entityType;

    let resourceName = this.resourceName;
    if (!resourceName) {
      throw new Error("There is no resourceName for this query");
    }

    if (metadataStore.isEmpty()) {
      if (throwErrorIfNotFound) {
        throw new Error("There is no metadata available for this query. " +
          "Are you querying the local cache before you've fetched metadata?");
      } else {
        return undefined;
      }
    }

    let entityTypeName = metadataStore.getEntityTypeNameForResourceName(resourceName);
    if (entityTypeName) {
      entityType = metadataStore._getStructuralType(entityTypeName) as EntityType;
    } else {
      entityType = this._getToEntityType(metadataStore, true);
    }

    if (!entityType) {
      if (throwErrorIfNotFound) {
        throw new Error(core.formatString("Cannot find an entityType for resourceName: '%1'. ", resourceName) + core.strings.TO_TYPE);
      } else {
        return undefined;
      }
    }

    this.fromEntityType = entityType;
    return entityType;

  }

  /** @hidden @internal */
  _getToEntityType(metadataStore: MetadataStore, skipFromCheck?: boolean): EntityType | undefined {
    // skipFromCheck is to avoid recursion if called from _getFromEntityType;
    if (this.resultEntityType instanceof EntityType) {
      return this.resultEntityType;
    } else if (this.resultEntityType) {
      // resultEntityType is a string
      this.resultEntityType = metadataStore._getStructuralType(this.resultEntityType, false) as EntityType;
      return this.resultEntityType;
    } else {
      // resolve it, if possible, via the resourceName
      // do not cache this value in this case
      // cannot determine the resultEntityType if a selectClause is present.
      // return skipFromCheck ? null : (!this.selectClause) && this._getFromEntityType(metadataStore, false);
      if (skipFromCheck || this.selectClause) {
        return undefined;
      } else {
        return this._getFromEntityType(metadataStore, false);
      }

    }
  }

  /** @hidden @internal */
  // for testing
  _toUri(em: EntityManager) {
    let ds = DataService.resolve([em.dataService]);
    return ds!.uriBuilder!.buildUri(this, em.metadataStore);
  }

}
EntityQuery.prototype._$typeName = "EntityQuery";

// private functions

function fromJSON(eq: EntityQuery, json: Object) {
  core.toJson(json, {
    "resourceName,from": null,
    // just the name comes back and will be resolved later
    "resultEntityType,toType": null,
    "wherePredicate,where": function (v: any) {
      return v ? new Predicate(v) : undefined;
    },
    "orderByClause,orderBy": function (v: any) {
      return v ? new OrderByClause(v) : undefined;
    },
    "selectClause,select": function (v: any) {
      return v ? new SelectClause(v) : undefined;
    },
    "expandClause,expand": function (v: any) {
      return v ? new ExpandClause(v) : undefined;
    },
    "skipCount,skip": null,
    "takeCount,take": null,
    parameters: function (v: any) {
      return core.isEmpty(v) ? undefined : v;
    },
    "inlineCountEnabled,inlineCount": false,
    "noTrackingEnabled,noTracking": false,
    "usePostEnabled,usePost": false,
    queryOptions: function (v: any) {
      return v ? QueryOptions.fromJSON(v) : undefined;
    }
  }, eq);
  return eq;
}

function clone<T>(eq: EntityQuery<T>, propName?: string, value?: any): EntityQuery<T> {
  // immutable queries mean that we don't need to clone if no change in value.
  if (propName) {
    if ((eq as Record<string, any>)[propName] === value) return eq;
  }
  // copying QueryOptions is safe because they are are immutable;
  let copy = core.extend(new EntityQuery(), eq, [
    "resourceName",
    "fromEntityType",
    "wherePredicate",
    "orderByClause",
    "selectClause",
    "skipCount",
    "takeCount",
    "expandClause",
    "inlineCountEnabled",
    "noTrackingEnabled",
    "usePostEnabled",
    "usesNameOnServer",
    "queryOptions",
    "entityManager",
    "dataService",
    "resultEntityType"
  ]) as EntityQuery<T>;
  copy.parameters = core.extend({}, eq.parameters);
  if (propName) {
    (copy as Record<string, any>)[propName] = value;
  }
  return copy;
}

function processUsing(eq: EntityQuery, mapArg: Object, value: any, propertyName?: string) {
  const map = mapArg as Record<string, any>;
  const eqx = eq as Record<string, any>;
  let typeName = value._$typeName || ((value instanceof BreezeEnum) && (value.constructor as any).name);
  let key = typeName && typeName.substr(0, 1).toLowerCase() + typeName.substr(1);
  if (propertyName && key !== propertyName) {
    throw new Error("Invalid value for property: " + propertyName);
  }
  if (key) {
    let fn = map[key];
    if (fn === undefined) {
      throw new Error("Invalid config property: " + key);
    } else if (fn === null) {
      eqx[key] = value;
    } else {
      fn(eq, value);
    }
  } else {
    core.objectForEach(value, (propName, val) => {
      processUsing(eq, map, val, propName);
    });
  }
}

function normalizePropertyPaths(propertyPaths: string | string[]) {
  assertParam(propertyPaths, "propertyPaths").isOptional().isString().or().isArray().isString().check();
  if (typeof propertyPaths === 'string') {
    propertyPaths = propertyPaths.split(",");
  }

  propertyPaths = propertyPaths.map(function (pp) {
    return pp.trim();
  });
  return propertyPaths;
}

function buildPredicate(entity: Entity) {
  let entityType = entity.entityType;
  let predParts = entityType.keyProperties.map(function (kp) {
    return Predicate.create(kp.name, FilterQueryOp.Equals, entity.getProperty(kp.name));
  });
  let pred = Predicate.and(predParts);
  return pred;
}

function buildKeyPredicate(entityKey: EntityKey) {
  let keyProps = entityKey.entityType.keyProperties;
  let preds = core.arrayZip(keyProps, entityKey.values, function (kp, v) {
    return Predicate.create(kp.name, FilterQueryOp.Equals, v);
  });
  let pred = Predicate.and(preds);
  return pred;
}

function buildNavigationPredicate(entity: Entity, navigationProperty: NavigationProperty) {
  if (navigationProperty.isScalar) {
    if (navigationProperty.foreignKeyNames.length === 0) return null;
    let relatedKeyValues = navigationProperty.foreignKeyNames.map((fkName) => {
      return entity.getProperty(fkName);
    });
    let entityKey = new EntityKey(navigationProperty.entityType, relatedKeyValues);
    return buildKeyPredicate(entityKey);
  } else {
    let inverseNp = navigationProperty.inverse;
    let foreignKeyNames = inverseNp ? inverseNp.foreignKeyNames : navigationProperty.invForeignKeyNames;
    if (foreignKeyNames.length === 0) return null;
    let keyValues = entity.entityAspect.getKey().values;
    let predParts = core.arrayZip(foreignKeyNames, keyValues, (fkName, kv) => {
      return Predicate.create(fkName, FilterQueryOp.Equals, kv);
    });
    return Predicate.and(predParts);
  }
}

/** Base class for BooleanQueryOp and FilterQueryOp */
export interface QueryOp {
  /** The operator for this enum. */
  operator: string;
}



/**
FilterQueryOp is an 'Enum' containing all of the valid  {@link Predicate}
filter operators for an {@link EntityQuery}.
*/
export class FilterQueryOp extends BreezeEnum implements QueryOp {
  /** The operator for this enum. */
  declare operator: string;

  /** Aliases: "eq", "==" */
  static Equals = new FilterQueryOp({ operator: "eq" });
  /**  Aliases: "ne", "!="  */
  static NotEquals = new FilterQueryOp({ operator: "ne" });
  /** Aliases: "gt", ">"   */
  static GreaterThan = new FilterQueryOp({ operator: "gt" });
  /** Aliases: "lt", "<"  */
  static LessThan = new FilterQueryOp({ operator: "lt" });
  /**  Aliases: "ge", ">="  */
  static GreaterThanOrEqual = new FilterQueryOp({ operator: "ge" });
  /**  Aliases: "le", "<="  */
  static LessThanOrEqual = new FilterQueryOp({ operator: "le" });
  /**  String operation: Is a string a substring of another string.  Aliases: "substringof"   */
  static Contains = new FilterQueryOp({ operator: "contains" });
  /** No aliases */
  static StartsWith = new FilterQueryOp({ operator: "startswith" });
  /** No aliases */
  static EndsWith = new FilterQueryOp({ operator: "endswith" });
  /**  Aliases: "some"  */
  static Any = new FilterQueryOp({ operator: "any" });
  /**  Aliases: "every"  */
  static All = new FilterQueryOp({ operator: "all" });
  /** No aliases */
  static In = new FilterQueryOp({ operator: "in" });
}
FilterQueryOp.prototype._$typeName = "FilterQueryOp";
FilterQueryOp.resolveSymbols();


/**
 BooleanQueryOp is an 'Enum' containing all of the valid  boolean
operators for an {@link EntityQuery}.
*/
export class BooleanQueryOp extends BreezeEnum implements QueryOp {
  /** The operator for this enum. */
  declare operator: string;

  static And = new BooleanQueryOp({ operator: "and" });
  static Or = new BooleanQueryOp({ operator: "or" });
  static Not = new BooleanQueryOp({ operator: "not" });

}
BooleanQueryOp.prototype._$typeName = "BooleanQueryOp";
BooleanQueryOp.resolveSymbols();


/** For use by breeze plugin authors only.  The class is used in most {@link UriBuilderAdapter} implementations
@adapter (see {@link UriBuilderAdapter})    
@hidden

An OrderByClause is a description of the properties and direction that the result
of a query should be sorted in.  OrderByClauses are immutable, which means that any
method that would modify an OrderByClause actually returns a new OrderByClause.

For example for an Employee object with properties of 'company' and 'lastName' the following would be valid expressions:
```ts
const obc = new OrderByClause(["company.companyName", "lastName"]);
```

or
```ts
const obc = new OrderByClause(["company.companyName desc", "lastName"]);
```

or
```ts
const obc = new OrderByClause(["company.companyName", "lastName"], true);
```
*/
export class OrderByClause {
  /** @hidden @internal */
  items: OrderByItem[];

  constructor(propertyPaths: string[] | OrderByClause[], isDesc?: boolean) {
    if (propertyPaths.length === 0) {
      throw new Error("OrderByClause cannot be empty");
    }

    // you can also pass in an array of orderByClauses
    if (propertyPaths[0] instanceof OrderByClause) {
      let clauses = propertyPaths as OrderByClause[];
      this.items = arrayFlatMap(clauses, c => c.items);
      // this.items = Array.prototype.concat.apply(clauses[0].items, clauses.slice(1).map(core.pluck("items")));
      // this.items = Array.prototype.concat.apply([], clauses.map(core.pluck("items")));
    } else {
      this.items = (propertyPaths as string[]).map(function (pp) {
        return new OrderByItem(pp, isDesc);
      });
    }

  }

  validate(entityType: EntityType) {
    if (entityType == null || entityType.isAnonymous) return;
    this.items.forEach((item) => {
      item.validate(entityType);
    });
  }

  getComparer(entityType: EntityType) {
    let orderByFuncs = this.items.map(function (obc) {
      return obc.getComparer(entityType);
    });
    return function (entity1: any, entity2: any) {
      for (let i = 0; i < orderByFuncs.length; i++) {
        let result = orderByFuncs[i](entity1, entity2);
        if (result !== 0) {
          return result;
        }
      }
      return 0;
    };
  }

  toJSONExt(context: EntityQueryJsonContext) {
    return this.items.map(function (item) {
      return context.propertyPathFn!(item.propertyPath) + (item.isDesc ? " desc" : "");
    });
  }

}

/** @hidden @internal */
export class OrderByItem {
  propertyPath: string;
  isDesc: boolean;
  lastProperty: EntityProperty;

  constructor(propertyPath: string, isDesc?: boolean) {
    if (!(typeof propertyPath === 'string')) {
      throw new Error("propertyPath is not a string");
    }
    propertyPath = propertyPath.trim();

    let parts = propertyPath.split(' ');
    // parts[0] is the propertyPath; [1] would be whether descending or not.
    // if (parts.length > 1 && isDesc !== true && isDesc !== false) {
    if (parts.length > 1 && isDesc == null) {
      isDesc = stringStartsWith(parts[1].toLowerCase(), "desc");
      if (!isDesc) {
        // isDesc is false but check to make sure its intended.
        let isAsc = stringStartsWith(parts[1].toLowerCase(), "asc");
        if (!isAsc) {
          throw new Error("the second word in the propertyPath must begin with 'desc' or 'asc'");
        }

      }
    }
    this.propertyPath = parts[0];
    this.isDesc = isDesc || false;
  }

  validate(entityType: EntityType): EntityProperty | undefined {
    if (entityType == null || entityType.isAnonymous) return;
    // will throw an exception on bad propertyPath
    this.lastProperty = entityType.getProperty(this.propertyPath, true) as EntityProperty;
    return this.lastProperty;
  }

  getComparer(entityType: EntityType) {
    let propDataType: DataType;
    let isCaseSensitive: boolean;
    if (!this.lastProperty) this.validate(entityType);
    if (this.lastProperty) {
      propDataType = (this.lastProperty as any).dataType;
      isCaseSensitive = this.lastProperty.parentType.metadataStore.localQueryComparisonOptions.isCaseSensitive;
    }

    let propertyPath = this.propertyPath;
    let isDesc = this.isDesc;

    return function (entity1: any, entity2: any) {
      let value1 = EntityAspect.getPropertyPathValue(entity1, propertyPath);
      let value2 = EntityAspect.getPropertyPathValue(entity2, propertyPath);
      let dataType = propDataType || (value1 && DataType.fromValue(value1)) || DataType.fromValue(value2);
      if (dataType === DataType.String) {
        if (isCaseSensitive) {
          value1 = value1 || "";
          value2 = value2 || "";
        } else {
          value1 = (value1 || "").toLowerCase();
          value2 = (value2 || "").toLowerCase();
        }
      } else {
        let normalize = DataType.getComparableFn(dataType);
        value1 = normalize(value1);
        value2 = normalize(value2);
      }
      if (value1 === value2) {
        return 0;
      } else if (value1 > value2 || value2 === undefined) {
        return isDesc ? -1 : 1;
      } else {
        return isDesc ? 1 : -1;
      }
    };
  }
}

/** For use by breeze plugin authors only.  The class is used in most {@link UriBuilderAdapter} implementations
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class SelectClause {
  propertyPaths: string[];
  /** @hidden @internal */
  _pathNames: string[];

  constructor(propertyPaths: string[]) {
    this.propertyPaths = propertyPaths;
    this._pathNames = propertyPaths.map(function (pp) {
      // every dot, not just the first: order.customer.companyName -> order_customer_companyName
      return pp.split(".").join("_");
    });
  }

  validate(entityType: EntityType) {
    if (entityType == null || entityType.isAnonymous) return; // can't validate yet
    // will throw an exception on bad propertyPath
    this.propertyPaths.forEach(function (path) {
      entityType.getProperty(path, true);
    });
  }

  /** @hidden @internal
  The property names of a projected result. Given the queried type, they are the names a
  remote query's results get: the server names each path by joining the server names of
  its properties (the ones sent in the select clause) with '_', and the client passes that
  name through the naming convention, as it does every key of an anonymous result. */
  _resultNames(entityType?: EntityType) {
    if (entityType == null || entityType.isAnonymous) return this._pathNames;
    const et: EntityType = entityType;
    const toClient = et.metadataStore.namingConvention.serverPropertyNameToClient;
    return this.propertyPaths.map(function (pp) {
      return toClient(et.clientPropertyPathToServer(pp, "_"));
    });
  }

  toFunction(config?: { entityType?: EntityType }) {
    let that = this;
    let names = this._resultNames(config && config.entityType);
    return function (entity: Entity) {
      let result = {};
      that.propertyPaths.forEach(function (path, i) {
        (result as Record<string, any>)[names[i]] = EntityAspect.getPropertyPathValue(entity, path);
      });
      return result;
    };
  }

  toJSONExt(context: EntityQueryJsonContext) {
    return this.propertyPaths.map(function (pp) {
      return context.propertyPathFn!(pp);
    });
  }
}

/** For use by breeze plugin authors only.  The class is used in most {@link UriBuilderAdapter} implementations
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class ExpandClause {
  propertyPaths: string[];

  constructor(propertyPaths: string[]) {
    this.propertyPaths = propertyPaths;
  }

  toJSONExt(context: EntityQueryJsonContext) {
    return this.propertyPaths.map(function (pp) {
      return context.propertyPathFn!(pp);
    });
  }

}


