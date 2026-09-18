import { core, arraySlice, hasOwnProperty as hasOwnProp, stringStartsWith as strStartsWith, stringEndsWith as strEndsWith } from '../core/core.js';
import { EntityType, StructuralType, DataProperty  } from '../metadata/entity-metadata.js';
import { QueryOp } from './entity-query.js';
import type { FilterQueryOp, RecursiveArray } from './entity-query.js';
import { DataType  } from '../metadata/data-type.js';
import { EntityAspect, Entity } from '../entity/entity-aspect.js';
import { LocalQueryComparisonOptions } from '../metadata/local-query-comparison-options.js';
import type { CollectionElement, CollectionPath, FilterOpFor, FilterValueFor, FunctionExpressionPath, PropertyPath, PropertyValue, QuantifierOp, WhereObject } from './property-path.js';

export interface Op {
  key: string;
  aliases?: string[];
  isFunction?: boolean;
}

/** @hidden @internal */
export interface OpMap {
  [key: string]: Op;
}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export interface Visitor {

}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export interface VisitContext {
  entityType?: EntityType;
  // usesNameOnServer?: boolean;
  toNameOnServer?: boolean;
  useExplicitDataType?: boolean;
  visitor?: Visitor;
}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export interface ExpressionContext {
  entityType?: EntityType;
  usesNameOnServer?: boolean;
  dataType?: DataType | string;
  isRHS?: boolean;
  isFnArg?: boolean;
}

/**
Builds {@link Predicate}s checked against one entity type - what {@link Predicate.for} returns.

The predicates it produces are ordinary Predicates, so combining them with `and`, `or` and `not`
works as it always has; those combinators take any Predicate and are not themselves checked.
*/
export interface TypedPredicateFactory<T> {
  // Escapes first, checked forms last - when no signature matches, the compiler reports the last
  // one, and its message is the useful one. Same arrangement as EntityQuery.where().
  /** A path only known at run time, or a query function, neither of which can be checked.
  ```ts
  const p = Predicate.for(Customer);
  const byColumn = p(userChosenColumn, "eq", value);          // userChosenColumn: string
  const byFunction = p("toLower(companyName)", "startsWith", "c");
  ```
  */
  <P extends string>(property: P extends FunctionExpressionPath ? P : (string extends P ? P : never),
    operator: string | FilterQueryOp, value: any): Predicate;
  <P extends string>(collection: string extends P ? P : never, quantifier: string | FilterQueryOp,
    property: string, operator: string | FilterQueryOp, value: any): Predicate;
  /** A property, an operator that suits its type, and a matching value.
  ```ts
  const p = Predicate.for(Order);
  const pred = p("freight", "gt", 100);
  const viaNavigation = p("customer.companyName", "startsWith", "A");
  ```
  */
  <P extends PropertyPath<T>, O extends FilterOpFor<PropertyValue<T, P>>>(
    property: P, operator: O, value: FilterValueFor<T, PropertyValue<T, P>, O>): Predicate;
  /** `any` or `all` over a collection, filtered by a Predicate built for the element type.
  ```ts
  const pd = Predicate.for(OrderDetail);
  const pred = Predicate.for(Order)("orderDetails", "any", pd("unitPrice", ">", 20));
  ```
  */
  (collection: CollectionPath<T>, quantifier: QuantifierOp | FilterQueryOp, predicate: Predicate): Predicate;
  /** `any` or `all` over a collection, then a filter on the element type.
  ```ts
  const p = Predicate.for(Customer);
  const pred = p("orders", "all", "freight", "lt", 100);
  ```
  */
  <P extends CollectionPath<T>,
    P2 extends PropertyPath<CollectionElement<T, P>>,
    O2 extends FilterOpFor<PropertyValue<CollectionElement<T, P>, P2>>>(
    collection: P, quantifier: QuantifierOp, property: P2, operator: O2,
    value: FilterValueFor<CollectionElement<T, P>, PropertyValue<CollectionElement<T, P>, P2>, O2>): Predicate;
  /** The object form, checked in full.
  ```ts
  const p = Predicate.for(Customer);
  const pred = p({ city: "London", companyName: { startsWith: "A" } });
  ```
  */
  (predicate: WhereObject<T>): Predicate;
}

/**
Used to define a 'where' predicate for an {@link EntityQuery}. Predicates are immutable, which means that any
method that would modify a Predicate actually returns a new Predicate.
```ts
const p = Predicate.for(Order);
const p1 = p("freight", ">", 100);
const p2 = p1.and(p("shipCity", "startsWith", "C"));
const query = EntityQuery.from(Order).where(p2);
```
*/
export class Predicate {
  /** The operator of this predicate. Its `key` is, for example, `eq` or `gt` for a comparison, `and` or `or` for a composite, `not`, or `any` or `all`. `undefined` for a pass-through predicate made from a raw filter string. __Read Only__ */
  declare op: Op;
  /** @hidden @internal */
  declare _entityType?: EntityType;
  /** @hidden @internal */
  declare aliasMap: OpMap;
  /** The name of the visitor method that handles this kind of predicate, such as `binaryPredicate` or `andOrPredicate`. Used by Breeze when it serializes or evaluates a predicate; applications do not normally need it. __Read Only__ */
  declare visitorMethodName: string;


  /**
  Predicate constructor. The compiler checks nothing it is given; for that, build the Predicate with
  {@link Predicate.for} or {@link Predicate.create} and a type argument instead.
  ```ts
  const p1 = new Predicate("companyName", "startsWith", "B");
  const query = EntityQuery.from(Customer).where(p1);
  ```

  or
  ```ts
  const p2 = new Predicate("region", FilterQueryOp.Equals, null);
  const query = EntityQuery.from(Customer).where(p2);
  ```
  @param args - `property, operator, value`, in that order:
  - **property**: A property name, a nested property name or an expression involving a property name.
  - **operator**: the filter query operator.
  - **value**: This will be treated as either a property expression or a literal depending on context.  In general,
  if the value can be interpreted as a property expression it will be, otherwise it will be treated as a literal.
  In most cases this works well, but you can also force the interpretation by making the value argument itself an object with a 'value'
  property and an 'isLiteral' property set to either true or false.  Breeze also tries to infer the dataType of any
  literal based on context, if this fails you can force this inference by making the value argument an object with a
  'value' property and a 'dataType' property set to one of the breeze.DataType enumeration instances.
  */
  constructor(...args: any[]) {
    if (args.length === 0) return;
    if (!(this instanceof Predicate)) {
      return new Predicate(...<any>args);
    }
    return (Predicate.create as (...a: any[]) => Predicate)(...args);
  }

  // Naming the entity type checks the predicate against it. The checked overloads come last, so
  // that when none matches it is their error the compiler reports rather than an escape's.
  //
  // How much is checked depends on which form you use, and it is a limit of the language rather
  // than a choice: supplying T explicitly stops TypeScript inferring the remaining type
  // parameters, so the three-argument form cannot tie its value back to the property named in
  // its first argument. The object form has only T to infer, so it is checked in full - operator
  // and value included, with a spelling suggestion for a misspelled key. Predicate.for() is the
  // other way to get the whole check, by inferring T from a constructor instead of being told it.
  static create(predicate: Predicate): Predicate;
  static create(rawFilterString: string): Predicate;
  static create(anArray: RecursiveArray<string | number | FilterQueryOp | Predicate>): Predicate;
  static create<P extends string>(property: P extends FunctionExpressionPath ? P : (string extends P ? P : never),
    operator: string | FilterQueryOp, value: any): Predicate;
  static create<P extends string>(collection: string extends P ? P : never,
    quantifier: string | FilterQueryOp, property: string,
    operator: string | FilterQueryOp, value: any): Predicate;
  static create(property: string, filterop: string, property2: string, filterop2: string,
    property3: string, filterop3: string, value: any): Predicate;
  /** Checks the property path against `T`. The operator and the value are not tied to that
  property: supplying `T` stops TypeScript inferring the rest from the path. Use the object form,
  or {@link Predicate.for}, to have them checked too.
  ```ts
  const p = Predicate.create<Customer>("companyName", "startsWith", "C");
  ```
  */
  static create<T = any>(property: PropertyPath<T> | FunctionExpressionPath,
    operator: string | FilterQueryOp, value: any): Predicate;
  /** `any` or `all` over a collection, filtered by a Predicate built for the element type.
  ```ts
  const pd = Predicate.for(OrderDetail);
  const p = Predicate.create<Order>("orderDetails", "any", pd("unitPrice", ">", 20));
  ```
  */
  static create<T = any>(collection: CollectionPath<T>, quantifier: QuantifierOp | FilterQueryOp,
    predicate: Predicate): Predicate;
  /** Checks the collection path against `T`.
  ```ts
  const p = Predicate.create<Customer>("orders", "any", "freight", ">", 100);
  ```
  */
  static create<T = any>(collection: CollectionPath<T>, quantifier: QuantifierOp | FilterQueryOp,
    property: string, operator: string | FilterQueryOp, value: any): Predicate;
  /** The object form, checked in full against `T`.
  ```ts
  const p = Predicate.create<Order>({ freight: { gt: 100 }, shipCity: { startsWith: "C" } });
  ```
  */
  static create<T = any>(predicate: WhereObject<T>): Predicate;
  /**
  Same as using the ctor, except that given the entity type as a type argument, the compiler checks
  the predicate against that type - everything in the object form, the property path in the
  three-argument form:
  ```ts
  const p1 = Predicate.create<Order>({ freight: { gt: 100 } });
  const p2 = Predicate.create<Order>("freight", ">", 100);
  ```

  Without one, nothing is checked, and
  ```ts
  const p3 = Predicate.create("freight", ">", 100);
  // is the same as
  const p4 = new Predicate("freight", ">", 100);
  ```
  @param args - `property, operator, value`, in that order:
  - **property**:  A property name, a nested property name or an expression involving a property name.
  - **operator**: the filter query operator.
  - **value**: This will be treated as either a property expression or a literal depending on context.  In general,
  if the value can be interpreted as a property expression it will be, otherwise it will be treated as a literal.
  In most cases this works well, but you can also force the interpretation by making the value argument itself an object with a 'value'
  property and an 'isLiteral' property set to either true or false.  Breeze also tries to infer the dataType of any
  literal based on context, if this fails you can force this inference by making the value argument an object with a
  'value' property and a 'dataType' property set to one of the breeze.DataType enumeration instances.
  */
  static create(...args: any[]) {
    // can be called from std javascript without new ( legacy )

    // empty ctor is used by all subclasses.
    if (args.length === 0) return new Predicate();
    if (args.length === 1) {
      // possibilities:
      //      Predicate([ aPredicate ]) or  Predicate(["freight", ">", 100]) - an array
      //      Predicate(aPredicate) - a predicate
      //      Predicate( "freight gt 100" }  // passthru ( i.e. a raw filter string) - a string
      //      Predicate( { freight: { ">": 100 } }) - an object
      let arg = arguments[0];
      if (Array.isArray(arg)) {
        if (arg.length === 1) {
          // recurse
          return new Predicate(arg[0]);
        } else {
          return createPredicateFromArray(arg);
        }
      } else if (arg instanceof Predicate) {
        return arg;
      } else if (typeof arg === 'string') {
        return new PassthruPredicate(arg);
      } else {
        return createPredicateFromObject(arg);
      }
    } else {
      // 2 possibilities
      //      Predicate("freight", ">", 100");
      //      Predicate("orders", "any", "freight",  ">", 950);
      return createPredicateFromArray(args);
    }
  }

  /** @hidden @internal */
  _validate(entityType: EntityType | undefined, usesNameOnServer?: boolean) {
    // noop here;
  }

  /**
  Creates a 'composite' Predicate by 'and'ing a set of specified Predicates together.
  ```ts
  const p = Predicate.for(Order);
  const dt = new Date(1988, 9, 12);
  const p1 = p("orderDate", "ne", dt);
  const p2 = p("shipCity", "startsWith", "C");
  const p3 = p("freight", ">", 100);
  const newPred = Predicate.and(p1, p2, p3);
  ```

  or
  ```ts
  const preds = [p1, p2, p3];
  const newPred = Predicate.and(preds);
  ```
  @param args - multiple Predicates or an array of Predicate. 
  Any null or undefined values passed in will be automatically filtered out before constructing the composite predicate.
  */
  static and(...args: any[]) {
    return new AndOrPredicate("and", args);
  }

  /**
  Creates a 'composite' Predicate by 'or'ing a set of specified Predicates together.
  ```ts
  const p = Predicate.for(Order);
  const dt = new Date(1988, 9, 12);
  const p1 = p("orderDate", "ne", dt);
  const p2 = p("shipCity", "startsWith", "C");
  const p3 = p("freight", ">", 100);
  const newPred = Predicate.or(p1, p2, p3);
  ```

  or
  ```ts
  const preds = [p1, p2, p3];
  const newPred = Predicate.or(preds);
  ```
  @param args - multiple Predicates or an array of Predicate.
  Any null or undefined values passed in will be automatically filtered out before constructing the composite predicate.
  */
  static or(...args: any[]) {
    return new AndOrPredicate("or", args);
  }

  /**
  Creates a 'composite' Predicate by 'negating' a specified predicate.
  ```ts
  const p1 = Predicate.create<Order>({ freight: { gt: 100 } });
  const not_p1 = Predicate.not(p1);
  ```

  This can also be accomplished using the 'instance' version of the 'not' method
  ```ts
  const not_p1 = p1.not();
  ```

  Both of which would be the same as
  ```ts
  const not_p1 = Predicate.create<Order>({ freight: { le: 100 } });
  ```
  */
  static not(pred: Predicate) {
    return pred.not();
  }

  /**
  Builds Predicates checked against one entity type.
  ```ts
  const p = Predicate.for(Customer);
  const pred = p("companyName", "startsWith", "C").and(p("city", "eq", "Vienna"));
  ```

  A standalone Predicate has no query to take an entity type from, so on its own
  {@link Predicate.create} cannot check anything. Naming the type supplies what is missing, the
  same way {@link EntityQuery.from} does for a query - and from a constructor rather than a type
  argument, so the type is written once.

  The constructor is read for its type only; nothing about it is kept, and the predicates are
  ordinary Predicates. It does not have to be registered with a MetadataStore for this - though
  if it is not, nothing validates the path against the metadata either, exactly as before.
  @param ctor - The entity class to check property paths against.
  @returns A factory that builds Predicates for that type.
  */
  static for<U extends Entity>(ctor: new () => U): TypedPredicateFactory<U> {
    return ((...args: any[]) => Predicate.create(...args as [any])) as TypedPredicateFactory<U>;
  }

  /**
  Adds functions that predicates can call, such as `toupper` in `Predicate.create<Customer>("toupper(companyName)", "==", "ACME")`,
  or replaces existing ones. Each entry maps a function name to `fn`, which evaluates it in local
  queries, and the {@link DataType} it returns. A server query sends the call by name, so the
  server must support the function too.
  ```ts
  Predicate.extendFuncMap({
    initial: { fn: (s: string) => s.charAt(0), dataType: DataType.String }
  });
  ```
  @param funcMap - The functions to add, keyed by name. Write names in lower case: Breeze lower-cases a
  function name when it parses a predicate.
  */
  static extendFuncMap (funcMap: {[key: string]: {fn: (...args: any[]) => any, dataType: DataType}}): void {
    for (let func in (funcMap || {})) {
      let config = funcMap[func];
      FnExpr._funcMap.set(func, config);
    }
  };

  /**
  'And's this Predicate with one or more other Predicates and returns a new 'composite' Predicate
  ```ts
  const p = Predicate.for(Order);
  const dt = new Date(1988, 9, 12);
  const p1 = p("orderDate", "ne", dt);
  const p2 = p("shipCity", "startsWith", "C");
  const p3 = p("freight", ">", 100);
  const newPred = p1.and(p2, p3);
  ```

  or
  ```ts
  const preds = [p2, p3];
  const newPred = p1.and(preds);
  ```

  The 'and' method is also used to write "fluent" expressions
  ```ts
  const p4 = p("shipCity", "startsWith", "F")
    .and(p("freight", "gt", 2000));
  ```

  It also takes the arguments of {@link Predicate.create} in place of a Predicate - such as
  `.and("freight", "gt", 2000)` - but the compiler does not check those.
  @param args - multiple Predicates or an array of Predicates. 
  Any null or undefined values passed in will be automatically filtered out before constructing the composite predicate.
  */
  and(...args: any[]) {
    return new AndOrPredicate("and", argsForAndOrPredicates(this, args));
  }

  /**
  'Or's this Predicate with one or more other Predicates and returns a new 'composite' Predicate
  ```ts
  const p = Predicate.for(Order);
  const dt = new Date(1988, 9, 12);
  const p1 = p("orderDate", "ne", dt);
  const p2 = p("shipCity", "startsWith", "C");
  const p3 = p("freight", ">", 100);
  const newPred = p1.or(p2, p3);
  ```

  or
  ```ts
  const preds = [p2, p3];
  const newPred = p1.or(preds);
  ```

  The 'or' method is also used to write "fluent" expressions
  ```ts
  const p4 = p("shipCity", "startsWith", "F")
    .or(p("freight", "gt", 2000));
  ```

  It also takes the arguments of {@link Predicate.create} in place of a Predicate - such as
  `.or("freight", "gt", 2000)` - but the compiler does not check those.
  @param args - multiple Predicates or an array of Predicates. 
  Any null or undefined values passed in will be automatically filtered out before constructing the composite predicate.
  */
  or(...args: any[]) {
    return new AndOrPredicate("or", argsForAndOrPredicates(this, args));
  }

  /**
  Returns the 'negated' version of this Predicate
  ```ts
  const p1 = Predicate.create<Order>({ freight: { gt: 100 } });
  const not_p1 = p1.not();
  ```

  This can also be accomplished using the 'static' version of the 'not' method
  ```ts
  const not_p1 = Predicate.not(p1);
  ```

  which would be the same as
  ```ts
  const not_p1 = Predicate.create<Order>({ freight: { le: 100 } });
  ```
  */
  not() {
    return new UnaryPredicate("not", this);
  }

  /**
  Returns this predicate in Breeze's JSON query syntax, with property paths as written - the object
  form that {@link Predicate.create} and {@link EntityQuery.where} also accept, such as
  `{ freight: { gt: 100 } }`. `JSON.stringify` calls it.
  */
  //
  toJSON() {
    // toJSON ( part of js standard - takes a single parameter
    // that is either "" or the name of the property being serialized.
    return this.toJSONExt({ entityType: this._entityType });
  }

  /** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
  @adapter (see {@link UriBuilderAdapter})    
  @hidden @internal 
  */
  toJSONExt(context: VisitContext) {
    return this.visit(context, toJSONVisitor);
  }

  /** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
  @adapter (see {@link UriBuilderAdapter})    
  @hidden @internal 
  */
  toFunction(context: VisitContext) {
    return this.visit(context, toFunctionVisitor);
  }

  /** Returns this predicate as a JSON string: `JSON.stringify` of {@link Predicate.toJSON}. Useful for logging and debugging. */
  toString() {
    return JSON.stringify(this);
  }

  /** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
  @adapter (see {@link UriBuilderAdapter})    
  @hidden @internal 
  */
  visit(context: VisitContext, visitor?: Visitor) {
    if (core.isEmpty(context)) {
      context = { entityType: undefined };
    } else if (context instanceof EntityType) {
      context = { entityType: context };
    } else if (!hasOwnProp(context, "entityType")) {
      throw new Error("All visitor methods must be called with a context object containing at least an 'entityType' property");
    }

    if (visitor) {
      context.visitor = visitor;
    }
    let tVisitor = visitor || context.visitor!;
    let fn = (tVisitor as Record<string, any>)[this.visitorMethodName];
    if (fn == null) {
      throw new Error("Unable to locate method: " + this.visitorMethodName + " on visitor");
    }

    let entityType = context.entityType;
    // don't bother validating if already done so ( or if no _validate method
    if (this._validate && (entityType == null || this._entityType !== entityType)) {
      // don't need to capture return value because validation fn doesn't have one.
      this._validate(entityType, context.toNameOnServer);
      this._entityType = entityType;
    }

    return fn.call(this, context);
  }

  /** @hidden @internal */
  _initialize(visitorMethodName: string, opMap: { [key: string]: { aliases?: string[], isFunction?: boolean }} = {}) {
    this.visitorMethodName = visitorMethodName;
    let aliasMap = this.aliasMap = {};
    for (let op in opMap ) {
      updateAliasMap(aliasMap, op, opMap[op] as Op);
    }
  }

  /** @hidden @internal */
  _resolveOp(op: string | QueryOp, okIfNotFound?: boolean) {
    let opStr = (typeof op === "string") ? op : op.operator;
    let result = this.aliasMap[opStr.toLowerCase()];
    if (!result && !okIfNotFound) {
      throw new Error("Unable to resolve operator: " + opStr);
    }
    return result;
  }

}

function createPredicateFromArray(arr: any[]) {
  // TODO: assert that length of the array should be > 3
  // Needs to handle:
  //      [ "freight", ">", 100"];
  //      [ "orders", "any", "freight",  ">", 950 ]
  //      [ "orders", "and", anotherPred ]
  //      [ "orders", "and", [ "freight, ">", 950 ]]
  let json: Record<string, any> = {};
  let value: Record<string, any> = {};
  json[arr[0]] = value;
  let op = arr[1];
  op = op.operator || op;  // incoming op will be either a string or a FilterQueryOp
  if (arr.length === 3) {
    value[op] = arr[2];
  } else {
    value[op] = createPredicateFromArray(arr.splice(2));
  }
  return createPredicateFromObject(json);
}

function createPredicateFromObject(obj: Object) {
  if (obj instanceof Predicate) return obj;

  if (typeof obj !== 'object') {
    throw new Error("Unable to convert to a Predicate: " + obj);
  }
  let keys = Object.keys(obj);
  let preds = keys.map(function (key) {
    return createPredicateFromKeyValue(key, (obj as Record<string, any>)[key]);
  });
  return (preds.length === 1) ? preds[0] : new AndOrPredicate("and", preds);
}

function createPredicateFromKeyValue(key: string, value: any): Predicate {
  // { and: [a,b] } key='and', value = [a,b]
  if (AndOrPredicate.prototype._resolveOp(key, true)) {
    return new AndOrPredicate(key, value);
  }

  // { not: a }  key= 'not', value = a
  if (UnaryPredicate.prototype._resolveOp(key, true)) {
    return new UnaryPredicate(key, value);
  }

  if ((typeof value !== 'object') || value == null || core.isDate(value)) {
    // { foo: bar } key='foo', value = bar ( where bar is a literal i.e. a string, a number, a boolean or a date.
    return new BinaryPredicate("eq", key, value);
  } else if (hasOwnProp(value, 'value')) {
    // { foo: { value: bar, dataType: xxx} } key='foo', value = bar ( where bar is an object representing a literal
    return new BinaryPredicate("eq", key, value);
  }

  if (Array.isArray(value)) {
    throw new Error("Unable to resolve predicate after the phrase: " + key);
  }

  let expr = key;
  let keys = Object.keys(value);
  let preds = keys.map(function (op) {

    // { a: { any: b } op = 'any', expr=a, value[op] = b
    if (AnyAllPredicate.prototype._resolveOp(op, true)) {
      return new AnyAllPredicate(op, expr, value[op]);
    }

    if (BinaryPredicate.prototype._resolveOp(op, true)) {
      // { a: { ">": b }} op = ">", expr=a, value[op] = b
      return new BinaryPredicate(op, expr, value[op]);
    } else if (hasOwnProp(value[op], 'value')) {
      // { a: { ">": { value: b, dataType: 'Int32' }} expr = a value[op] = { value: b, dataType: 'Int32' }
      return new BinaryPredicate("eq", expr, value[op]);
    }

    let msg = core.formatString("Unable to resolve predicate after the phrase: '%1' for operator: '%2'  and value: '%3'", expr, op, value[op]);
    throw new Error(msg);

  });

  return (preds.length === 1) ? preds[0] : new AndOrPredicate("and", preds);
}

function argsForAndOrPredicates(obj: {}, args: any[]) {
  let preds = args[0];
  if (preds instanceof Predicate) {
    preds = arraySlice(args);
  } else if (!Array.isArray(preds)) {
    preds = [new Predicate(arraySlice(args))];
  }
  return [obj].concat(preds);
}

function updateAliasMap(aliasMap: OpMap, opStr: string, op: Op) {
  let key = opStr.toLowerCase();
  op.key = key;
  aliasMap[key] = op;

  op.aliases && op.aliases.forEach((alias: any) => {
    aliasMap[alias.toLowerCase()] = op;
  });
}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden @internal 
*/
class PassthruPredicate extends Predicate {
  value: any;
  constructor(value: any) {
    super();
    this.value = value;
  }

  // _validate = core.noop;
}
PassthruPredicate.prototype._initialize('passthruPredicate');

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class UnaryPredicate extends Predicate {
  pred: Predicate;
  constructor(op: string | QueryOp, ...args: any[]) {
    super();
    this.op = this._resolveOp(op);
    this.pred = new Predicate(args);
  }

  _validate(entityType: EntityType, usesNameOnServer?: boolean) {
    this.pred._validate(entityType, usesNameOnServer);
  }
}

UnaryPredicate.prototype._initialize('unaryPredicate', {
  'not': { aliases: ['!', '~'] },
});

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class BinaryPredicate extends Predicate {
  expr1Source: any;
  expr2Source: any;
  expr1?: PredicateExpression;
  expr2?: PredicateExpression;
  constructor(op: string | QueryOp, expr1: any, expr2: any) {
    super();
    // 5 public props op, expr1Source, expr2Source, expr1, expr2
    this.op = this._resolveOp(op);
    this.expr1Source = expr1;
    this.expr2Source = expr2;
    // this.expr1 and this.expr2 won't be
    // determined until validate is run
  }


  _validate(entityType: EntityType, usesNameOnServer?: boolean) {
    let expr1Context = { entityType: entityType, usesNameOnServer: usesNameOnServer };
    this.expr1 = createExpr(this.expr1Source, expr1Context);
    if (this.expr1 == null) {
      throw new Error("Unable to validate 1st expression: " + this.expr1Source);
    }
    if (this.expr1 instanceof LitExpr) {
      // lhs must be either a property or a function.
      throw new Error("The left hand side of a binary predicate cannot be a literal expression, it must be a valid property or functional predicate expression: " + this.expr1Source);
    }

    if (this.op.key === 'in' && !Array.isArray(this.expr2Source)) {
      throw new Error("The 'in' operator requires that its right hand argument be an array");
    }
    let expr2Context = core.extend(expr1Context, { isRHS: true, dataType: this.expr1.dataType });
    this.expr2 = createExpr(this.expr2Source, expr2Context);
    if (this.expr2 == null) {
      throw new Error("Unable to validate 2nd expression: " + this.expr2Source);
    }

    if (this.expr1.dataType == null) {
      this.expr1.dataType = this.expr2.dataType;
    }
  }


}

BinaryPredicate.prototype._initialize('binaryPredicate', {
  'eq': {
    aliases: ["==", "equals", "equal"]
  },
  'ne': {
    aliases: ["!=", "~=", "notequals", "notequal"]
  },
  'lt': {
    aliases: ["<", "lessthan"]
  },
  'le': {
    aliases: ["<=", "lessthanorequal"]
  },
  'gt': {
    aliases: [">", "greaterthan"]
  },
  'ge': {
    aliases: [">=", "greaterthanorequal"]
  },
  'startswith': {
    isFunction: true
  },
  'endswith': {
    isFunction: true
  },
  'contains': {
    aliases: ["substringof"],
    isFunction: true
  },
  'in': {

  }
});

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden
*/
export class AndOrPredicate extends Predicate {
  preds: Predicate[];
  constructor(op: string | QueryOp, preds: any[]) {
    super();
    this.op = this._resolveOp(op);
    if (preds.length === 1 && Array.isArray(preds[0])) {
      preds = preds[0];
    }
    this.preds = preds.filter(function (pred) {
      return pred != null;
    }).map(function (pred) {
      return new Predicate(pred);
    });
    if (this.preds.length === 1) {
      return this.preds[0] as AndOrPredicate; // HACK: this.preds[0] is actually NOT a AndOrPredicate but some other kind of pred.
    }
  }

  _validate(entityType: EntityType, usesNameOnServer?: boolean) {
    this.preds.forEach((pred) => {
      pred._validate(entityType, usesNameOnServer);
    });
  }
}

AndOrPredicate.prototype._initialize("andOrPredicate", {
  'and': { aliases: ['&&'] },
  'or': { aliases: ['||'] }
} );

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class AnyAllPredicate extends Predicate {
  /** @internal */
  expr: PredicateExpression;
  exprSource: string;
  pred: Predicate;
  // 4 public props: op, exprSource, expr, pred
  constructor(op: string | QueryOp, expr: string, pred: any) {
    super();
    this.op = this._resolveOp(op);
    this.exprSource = expr;
    // this.expr will not be resolved until validate is called
    this.pred = new Predicate(pred);
  }

  _validate(entityType: EntityType, usesNameOnServer: boolean) {
    this.expr = createExpr(this.exprSource, { entityType: entityType, usesNameOnServer: usesNameOnServer } as ExpressionContext);
    // can't really know the predicateEntityType unless the original entity type was known.
    if (entityType == null || entityType.isAnonymous) {
      this.expr.dataType = undefined;
    }
    this.pred._validate(this.expr.dataType as EntityType | undefined, usesNameOnServer);
  }

}

AnyAllPredicate.prototype._initialize("anyAllPredicate", {
  'any': { aliases: ['some'] },
  'all': { aliases: ["every"] }
});

/** @hidden */
export class PredicateExpression {
  visitorMethodName: string;
  visit: Function; // TODO
  dataType?: DataType | StructuralType;
  constructor(visitorMethodName: string) {
    this.visitorMethodName = visitorMethodName;
    // give expressions the Predicate prototype method
    this.visit = Predicate.prototype.visit;
  }

  // default impls - may/will be overridden be subclass expressions
  _validate(entityType: EntityType | undefined, usesNameOnServer?: boolean) {
    // noop;
  }
}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class LitExpr extends PredicateExpression {
  value: any;
  /** Narrows the optional dataType on PredicateExpression: a LitExpr always has one,
      because the constructor falls back to DataType.fromValue when none is supplied. */
  declare dataType: DataType;
  hasExplicitDataType: boolean;
  // 2 public props: value, dataType
  constructor(value: any, dataType: string | DataType | undefined, hasExplicitDataType?: boolean) {
    super("litExpr");
    // dataType may come is an a string
    let dt1 = resolveDataType(dataType);
    // if the DataType comes in as Undefined this means
    // that we should NOT attempt to parse it but just leave it alone
    // for now - this is usually because it is part of a Func expr.
    // The cast holds for test/tsconfig.json, which checks src/ again with strictNullChecks off;
    // `resolveDataType` returns `DataType | string | undefined`, and only the strict pass drops
    // the `string` here.
    let dt2 = (dt1 || DataType.fromValue(value)) as DataType;

    if (dt2.parse) {
      if (Array.isArray(value)) {
        this.value = value.map((v) => { return dt2.parse!(v, typeof v); });
      } else {
        this.value = dt2.parse(value, typeof value);
      }
    } else {
      this.value = value;
    }
    this.dataType = dt2;
    this.hasExplicitDataType = !!hasExplicitDataType;
  }

  toString() {
    return " LitExpr - value: " + this.value.toString() + " dataType: " + this.dataType.toString();
  }

}

function resolveDataType(dataType?: DataType | string) {
  if (dataType == null) return dataType;
  // if (DataType.contains(dataType)) {
  if (dataType instanceof DataType) {
    return dataType;
  }
  if (typeof dataType === 'string') {
    let dt = DataType.fromName(dataType) as DataType;
    if (dt) return dt;
    throw new Error("Unable to resolve a dataType named: " + dataType);
  }

  throw new Error("The dataType parameter passed into this literal expression is not a 'DataType'" + dataType);
}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden 
*/
export class PropExpr extends PredicateExpression {
  propertyPath: string;
  // two public props: propertyPath, dateType
  constructor(propertyPath: string) {
    super('propExpr');
    this.propertyPath = propertyPath;
    //this.dataType = DataType.Undefined;
    // this.dataType resolved after validate ( if not on an anon type }
  }

  toString() {
    return " PropExpr - " + this.propertyPath;
  }

  _validate(entityType: EntityType | undefined, usesNameOnServer?: boolean) {

    if (entityType == null || entityType.isAnonymous) return;
    let props = entityType.getPropertiesOnPath(this.propertyPath, null, false);

    if (!props) {
      let msg = core.formatString("Unable to resolve propertyPath.  EntityType: '%1'   PropertyPath: '%2'", entityType.name, this.propertyPath);
      throw new Error(msg);
    }
    // get the last property
    let prop = props[props.length - 1];
    if (prop instanceof DataProperty) {
      this.dataType = prop.dataType;
    } else {
      this.dataType = prop.entityType;
    }
  }

}

/** For use by breeze plugin authors only. The class is for use in building a {@link UriBuilderAdapter} implementation. 
@adapter (see {@link UriBuilderAdapter})    
@hidden
*/
export class FnExpr extends PredicateExpression {
  fnName: string;
  exprs: PredicateExpression[];
  localFn: any; // TODO:
  constructor(fnName: string, exprs: PredicateExpression[]) {
    super('fnExpr');
    // 4 public props: fnName, exprs, localFn, dataType
    this.fnName = fnName;
    this.exprs = exprs;
    let qf = FnExpr._funcMap.get(fnName);
    if (qf == null) {
      throw new Error("Unknown function: " + fnName);
    }
    this.localFn = qf.fn;
    this.dataType = qf.dataType;
  }

  toString() {
    let exprStr = this.exprs.map(function (expr) {
      expr.toString();
    }).toString();
    return "FnExpr - " + this.fnName + "(" + exprStr + ")";
  }

  _validate(entityType: EntityType | undefined, usesNameOnServer?: boolean) {
    this.exprs.forEach(function (expr) {
      expr._validate(entityType, usesNameOnServer);
    });
  }

  static _funcMap = new Map<string, { fn: (...args: any[]) => any; dataType: DataType }>(Object.entries({
    toupper: {
      fn: function (source: string) {
        return source.toUpperCase();
      }, dataType: DataType.String
    },
    tolower: {
      fn: function (source: string) {
        return source.toLowerCase();
      }, dataType: DataType.String
    },
    substring: {
      // As on the server (.NET String.Substring(startIndex, length)), the third argument is
      // a length, not an end index. Function arguments arrive unparsed, often as strings.
      fn: function (source: string, pos: number, length?: number) {
        const start = Number(pos);
        return length == null ? source.substring(start) : source.substring(start, start + Number(length));
      }, dataType: DataType.String
    },
    substringof: {
      fn: function (find: string, source: string) {
        return source.indexOf(find) >= 0;
      }, dataType: DataType.Boolean
    },
    length: {
      fn: function (source: any) {
        return source.length;
      }, dataType: DataType.Int32
    },
    trim: {
      fn: function (source: string) {
        return source.trim();
      }, dataType: DataType.String
    },
    concat: {
      fn: function (s1: string, s2: string) {
        return s1.concat(s2);
      }, dataType: DataType.String
    },
    replace: {
      fn: function (source: string, find: string, replace: string) {
        return source.replace(find, replace);
      }, dataType: DataType.String
    },
    startswith: {
      fn: function (source: string, find: string) {
        return strStartsWith(source, find);
      }, dataType: DataType.Boolean
    },
    endswith: {
      fn: function (source: string, find: string) {
        return strEndsWith(source, find);
      }, dataType: DataType.Boolean
    },
    indexof: {
      fn: function (source: any, find: any) {
        return source.indexOf(find);
      }, dataType: DataType.Int32
    },
    round: {
      fn: function (source: number) {
        return Math.round(source);
      }, dataType: DataType.Int32
    },
    ceiling: {
      fn: function (source: number) {
        return Math.ceil(source);
      }, dataType: DataType.Int32
    },
    floor: {
      fn: function (source: number) {
        return Math.floor(source);
      }, dataType: DataType.Int32
    },
    second: {
      fn: function (source: Date) {
        return source.getSeconds();
      }, dataType: DataType.Int32
    },
    minute: {
      fn: function (source: Date) {
        return source.getMinutes();
      }, dataType: DataType.Int32
    },
    hour: {
      fn: function (source: Date) {
        return source.getHours();
      }, dataType: DataType.Int32
    },
    day: {
      fn: function (source: Date) {
        return source.getDate();
      }, dataType: DataType.Int32
    },
    month: {
      fn: function (source: Date) {
        return source.getMonth() + 1;
      }, dataType: DataType.Int32
    },
    year: {
      fn: function (source: Date) {
        return source.getFullYear();
      }, dataType: DataType.Int32
    }
  }));

}

// TODO: add dataTypes for the args next - will help to infer other dataTypes.


let RX_IDENTIFIER = /^[a-z_][\w.$]*$/i;
// comma delimited expressions ignoring commas inside of both single and double quotes.
let RX_COMMA_DELIM1 = /('[^']*'|[^,]+)/g;
let RX_COMMA_DELIM2 = /("[^"]*"|[^,]+)/g;
let DELIM = String.fromCharCode(191);

function createExpr(source: any, exprContext: ExpressionContext) {
  let entityType = exprContext.entityType;

  // the right hand side of an 'in' clause
  if (Array.isArray(source)) {
    if (!exprContext.isRHS) {
      throw new Error("Array expressions are only permitted on the right hand side of a BinaryPredicate");
    }
    return new LitExpr(source, exprContext.dataType!);
  }

  if (!(typeof source === 'string')) {
    if (source != null && typeof source === 'object' && !source.toISOString) {
      // source is an object but not a Date-like thing such as a JS or MomentJS Date
      if (source.value === undefined) {
        throw new Error("Unable to resolve an expression for: " + source + " on entityType: " + (entityType ? entityType.name : 'null'));
      }
      // { value, isProperty: true } or { value, isLiteral: false } forces a property;
      // anything else (including { value, isLiteral: true }) is a literal.
      if (source.isProperty || source.isLiteral === false) {
        return new PropExpr(source.value);
      } else {
        // we want to insure that any LitExpr created this way is tagged with 'hasExplicitDataType: true'
        // because we want to insure that if we roundtrip thru toJSON that we don't
        // accidentally reinterpret this node as a PropExpr.
        // return new LitExpr(source.value, source.dataType || context.dataType, !!source.dataType);
        return new LitExpr(source.value, source.dataType || exprContext.dataType, true);
      }
    } else {
      return new LitExpr(source, exprContext.dataType);
    }
  }

  if (exprContext.isRHS) {
    if (entityType == null || entityType.isAnonymous) {
      // if entityType is unknown then assume that the rhs is a literal
      return new LitExpr(source, exprContext.dataType);
    } else {
      return parseLitOrPropExpr(source, exprContext);
    }
  } else {
    let regex = /\([^()]*\)/;
    let m: RegExpExecArray | null;
    let tokens: string[] = [];
    let i = 0;
    while (m = regex.exec(source)) {
      let token = m[0];
      tokens.push(token);
      let repl = DELIM + i++;
      source = source.replace(token, repl);
    }

    let expr = parseExpr(source, tokens, exprContext);
    expr._validate(entityType, exprContext.usesNameOnServer);
    return expr;
  }
}

function parseExpr(source: string, tokens: string[], exprContext: ExpressionContext): PredicateExpression {
  let parts = source.split(DELIM);
  if (parts.length === 1) {
    return parseLitOrPropExpr(parts[0], exprContext);
  } else {
    return parseFnExpr(source, parts, tokens, exprContext);
  }
}

function parseLitOrPropExpr(value: string, exprContext: ExpressionContext): PredicateExpression {
  value = value.trim();
  // value is either a string, a quoted string, a number, a bool value, or a date
  // if a string ( not a quoted string) then this represents a property name ( 1st ) or a lit string ( 2nd)
  let firstChar = value.substr(0, 1);
  let isQuoted = (firstChar === "'" || firstChar === '"') && value.length > 1 && value.substr(value.length - 1) === firstChar;
  if (isQuoted) {
    let unquotedValue = value.substr(1, value.length - 2);
    return new LitExpr(unquotedValue, exprContext.dataType || DataType.String);
  } else {
    let entityType = exprContext.entityType;
    // TODO: get rid of isAnonymous below when we get the chance.
    if (entityType == null || entityType.isAnonymous) {
      // this fork will only be reached on the LHS of an BinaryPredicate -
      // a RHS expr cannot get here with an anon type
      return new PropExpr(value);
    } else {
      let mayBeIdentifier = RX_IDENTIFIER.test(value);
      if (mayBeIdentifier) {
        // if (entityType.getProperty(value, false) != null) {
        if (entityType.getPropertiesOnPath(value, null, false) != null) {
          return new PropExpr(value);
        }
      }
    }
    // we don't really know the datatype here because even though it comes in as a string
    // its usually a string BUT it might be a number  i.e. the "1" or the "2" from an expr
    // like "toUpper(substring(companyName, 1, 2))"
    return new LitExpr(value, exprContext.dataType);
  }
}

function parseFnExpr(source: string, parts: string[], tokens: string[], exprContext: ExpressionContext) {
  let fnName = parts[0].trim().toLowerCase();

  let argSource = (tokens as unknown as Record<string, string>)[parts[1]].trim() as string;
  if (argSource.substr(0, 1) === "(") {
    argSource = argSource.substr(1, argSource.length - 2);
  }
  let commaMatchStr = source.indexOf("'") >= 0 ? RX_COMMA_DELIM1 : RX_COMMA_DELIM2;
  let args = argSource.match(commaMatchStr);
  let newContext = core.extend({}, exprContext) as ExpressionContext;
  // a dataType of Undefined on a context basically means not to try parsing
  // the value if the expr is a literal
  newContext.dataType = DataType.Undefined;
  newContext.isFnArg = true;
  let exprs = args!.map(function (a) {
    return parseExpr(a, tokens, newContext);
  });
  return new FnExpr(fnName, exprs);
}

// toFunctionVisitor

let toFunctionVisitor = {

  isExtended: false,

  passthruPredicate: function (this: PassthruPredicate) {
    throw new Error("Cannot execute an PassthruPredicate expression against the local cache: " + this.value);
  },

  unaryPredicate: function (this: UnaryPredicate, context: VisitContext) {
    let predFn = this.pred.visit(context);
    switch (this.op.key) {
      case "not":
        return function (entity: any) {
          return !predFn(entity);
        };
      default:
        throw new Error("Invalid unary operator:" + this.op.key);
    }
  },

  binaryPredicate: function (this: BinaryPredicate, context: VisitContext) {
    let expr1Fn = this.expr1!.visit(context);
    let expr2Fn = this.expr2!.visit(context);
    let dataType = this.expr1!.dataType || this.expr2!.dataType;
    let lqco = context.entityType!.metadataStore.localQueryComparisonOptions;
    let predFn = getBinaryPredicateFn(this, dataType as DataType, lqco);
    if (predFn == null) {
      throw new Error("Invalid binaryPredicate operator:" + this.op.key);
    }
    return function (entity: Entity) {
      return predFn!(expr1Fn(entity), expr2Fn(entity));
    };
  },

  andOrPredicate: function (this: AndOrPredicate, context: VisitContext) {
    let predFns = this.preds.map((pred) => {
      return pred.visit(context);
    });
    switch (this.op!.key) {
      case "and":
        return function (entity: any) {
          let result = predFns.reduce(function (prev, cur) {
            return prev && cur(entity);
          }, true);
          return result;
        };
      case "or":
        return function (entity: any) {
          let result = predFns.reduce(function (prev, cur) {
            return prev || cur(entity);
          }, false);
          return result;
        };
      default:
        throw new Error("Invalid boolean operator:" + this.op!.key);
    }
  },

  anyAllPredicate: function (this: AnyAllPredicate, context: VisitContext) {
    let exprFn = this.expr.visit(context);
    let newContext = core.extend({}, context) as VisitContext;
    newContext.entityType = this.expr.dataType as EntityType;
    let predFn = this.pred.visit(newContext);
    let anyAllPredFn = getAnyAllPredicateFn(this.op);
    return function (entity: any) {
      return anyAllPredFn(exprFn(entity), predFn);
    };
  },

  litExpr: function (this: LitExpr) {
    let value = this.value;
    return function (entity: any) {
      return value;
    };
  },

  propExpr: function (this: PropExpr) {
    let propertyPath = this.propertyPath;
    let properties = propertyPath.split('.');
    if (properties.length === 1) {
      return function (entity: any) {
        return entity.getProperty(propertyPath);
      };
    } else {
      return function (entity: Entity) {
        return EntityAspect.getPropertyPathValue(entity, properties);
      };
    }
  },

  fnExpr: function (this: FnExpr, context: ExpressionContext) {
    let exprFns = this.exprs.map(function (expr) {
      return expr.visit(context);
    });
    let that = this;
    return function (entity: any) {
      let values = exprFns.map(function (exprFn) {
        let value = exprFn(entity);
        return value;
      });
      let result = that.localFn.apply(null, values);
      return result;
    };
  }

};

function getAnyAllPredicateFn(op: Op): (v1: any[], v2: any) => boolean {
  switch (op.key) {
    case "any":
      return function (v1, v2) {
        return v1.some(function (v) {
          return v2(v);
        });
      };
    case "all":
      return function (v1, v2) {
        return v1.every(function (v) {
          return v2(v);
        });
      };
    default:
      throw new Error("Unknown operator: " + op.key);
  }
}

function getBinaryPredicateFn(binaryPredicate: BinaryPredicate, dataType: DataType, lqco: LocalQueryComparisonOptions) {
  let op = binaryPredicate.op;
  let mc = DataType.getComparableFn(dataType);
  let predFn: (v1: any, v2: any) => boolean;
  switch (op.key) {
    case 'eq':
      predFn = function (v1, v2) {
        if (v1 && typeof v1 === 'string') {
          return stringEquals(v1, v2, lqco);
        } else {
          return mc(v1) === mc(v2);
        }
      };
      break;
    case 'ne':
      predFn = function (v1, v2) {
        if (v1 && typeof v1 === 'string') {
          return !stringEquals(v1, v2, lqco);
        } else {
          return mc(v1) !== mc(v2);
        }
      };
      break;
    case 'gt':
      predFn = function (v1, v2) {
        return mc(v1) > mc(v2);
      };
      break;
    case 'ge':
      predFn = function (v1, v2) {
        return mc(v1) >= mc(v2);
      };
      break;
    case 'lt':
      predFn = function (v1, v2) {
        return mc(v1) < mc(v2);
      };
      break;
    case 'le':
      predFn = function (v1, v2) {
        return mc(v1) <= mc(v2);
      };
      break;
    case 'startswith':
      predFn = function (v1, v2) {
        return stringStartsWith(v1, v2, lqco);
      };
      break;
    case 'endswith':
      predFn = function (v1, v2) {
        return stringEndsWith(v1, v2, lqco);
      };
      break;
    case 'contains':
      predFn = function (v1, v2) {
        return stringContains(v1, v2, lqco);
      };
      break;
    case 'in':
      predFn = function (v1: any, v2: any[]) {
        v1 = mc(v1);
        v2 = v2.map(function (v) { return mc(v); });
        return v2.indexOf(v1) >= 0;
      };
      break;
    default:
      return null;
  }
  return predFn;
}

function stringEquals(a: any, b: any, lqco: LocalQueryComparisonOptions) {
  if (b == null) return false;
  if (typeof b !== 'string') {
    b = b.toString();
  }
  if (lqco.usesSql92CompliantStringComparison) {
    a = (a || "").trim();
    b = (b || "").trim();
  }
  if (!lqco.isCaseSensitive) {
    a = (a || "").toLowerCase();
    b = (b || "").toLowerCase();
  }
  return a === b;
}

function stringStartsWith(a: any, b: any, lqco: LocalQueryComparisonOptions) {
  if (!lqco.isCaseSensitive) {
    a = (a || "").toLowerCase();
    b = (b || "").toLowerCase();
  }
  return strStartsWith(a, b);
}

function stringEndsWith(a: any, b: any, lqco: LocalQueryComparisonOptions) {
  if (!lqco.isCaseSensitive) {
    a = (a || "").toLowerCase();
    b = (b || "").toLowerCase();
  }
  return strEndsWith(a, b);
}

function stringContains(a: any, b: any, lqco: LocalQueryComparisonOptions) {
  if (!lqco.isCaseSensitive) {
    a = (a || "").toLowerCase();
    b = (b || "").toLowerCase();
  }
  return a.indexOf(b) >= 0;
}

// toJSONVisitor

let toJSONVisitor = {

  passthruPredicate: function (this: PassthruPredicate) {
    return this.value;
  },

  unaryPredicate: function (this: UnaryPredicate, context: VisitContext) {
    let predVal = this.pred.visit(context);
    let json: Record<string, any> = {};
    json[this.op.key] = predVal;
    return json;
  },

  binaryPredicate: function (this: BinaryPredicate, context: VisitContext) {
    let expr1Val = this.expr1!.visit(context);
    let expr2Val = this.expr2!.visit(context);
    let json: Record<string, any> = {};
    if (this.expr2 instanceof PropExpr) {
      expr2Val = { value: expr2Val, isProperty: true };
    }
    if (this.op.key === "eq") {
      json[expr1Val] = expr2Val;
    } else {
      let value: Record<string, any> = {};
      json[expr1Val] = value;
      value[this.op.key] = expr2Val;
    }
    return json;
  },

  andOrPredicate: function (this: AndOrPredicate, context: VisitContext) {
    let predVals = this.preds.map(function (pred) {
      return pred.visit(context);
    });
    if (!predVals || !predVals.length) {
      return {};
    }
    let json: Record<string, any> | undefined;
    // normalizeAnd clauses if possible.
    // passthru predicate will appear as string and their 'ands' can't be 'normalized'
    if (this.op!.key === 'and' && predVals.length === 2 && !predVals.some((v) => v.or || typeof(v) === 'string')) {
      // normalize 'and' clauses - will return null if can't be combined.
      json = predVals.reduce(combine);
    }
    if (json == null) {
      json = {};
      json[this.op!.key!] = predVals;
    }
    return json;
  },

  anyAllPredicate: function (this: AnyAllPredicate, context: VisitContext) {
    let exprVal = this.expr.visit(context);
    let newContext = core.extend({}, context) as VisitContext;
    newContext.entityType = this.expr.dataType as EntityType;
    let predVal = this.pred.visit(newContext);
    let json: Record<string, any> = {};
    let value: Record<string, any> = {};
    value[this.op.key] = predVal;
    json[exprVal] = value;
    return json;
  },

  litExpr: function (this: LitExpr, context: VisitContext) {
    // special handling for DateOnly because it serializes improperly
    const value = (this.dataType === DataType.DateOnly) ? DataType.toDateOnlyString(this.value) : this.value;
    if (this.hasExplicitDataType || context.useExplicitDataType) {
      return { value: value, dataType: this.dataType.name };
    } else {
      return value;
    }
  },

  propExpr: function (this: PropExpr, context: VisitContext) {
    if (context.toNameOnServer) {
      if (!context.entityType) {
        console.warn(`No EntityType for propertyPath "${this.propertyPath}".  ${core.strings.TO_TYPE}`);
        return this.propertyPath;
      }
      return context.entityType!.clientPropertyPathToServer(this.propertyPath);
    } else {
      return this.propertyPath;
    }
  },

  fnExpr: function (this: FnExpr, context: VisitContext) {
    let exprVals = this.exprs.map(function (expr) {
      return expr.visit(context);
    });
    return this.fnName + "(" + exprVals.join(",") + ")";
  }

};

function combine(j1: Object, j2: Object) {
  const a = j1 as Record<string, any>, b = j2 as Record<string, any>;
  let ok = Object.keys(b).every(function (key) {
    if (a.hasOwnProperty(key)) {
      if (typeof (b[key]) !== 'object') {
        // exit and indicate that we can't combine
        return false;
      }
      if (combine(a[key], b[key]) == null) {
        return false;
      }
    } else if (typeof (a) !== 'object') {
      // cannot assign to j1[key]
      return false;
    } else {
      a[key] = b[key];
    }
    return true;
  });
  return ok ? j1 : null;
}




