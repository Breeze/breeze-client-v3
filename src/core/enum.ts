/*
 * Copyright 2012-2026 IdeaBlade, Inc.  All Rights Reserved.  
 * Use, reproduction, distribution, and modification of this code is subject to the terms and 
 * conditions of the IdeaBlade Breeze license, available at http://www.breezejs.com/license
 *
 * Author: Jay Traband
 */

/**
Base class for all Breeze enumerations, such as EntityState, DataType, FetchStrategy, MergeStrategy etc.
A Breeze Enum is a namespaced set of constant values.  Each Enum consists of a group of related constants, called 'symbols'.
Unlike enums in some other environments, each 'symbol' can have both methods and properties.
>     class DayOfWeek extends BreezeEnum {
>       dayIndex: number;
>       isWeekend?: boolean;
>       nextDay() {
>         let nextIndex = (this.dayIndex + 1) % 7;
>         return DayOfWeek.getSymbols()[nextIndex];
>       }
>
>       static Monday = new DayOfWeek( { dayIndex: 0});
>       static Tuesday = new DayOfWeek( { dayIndex: 1 });
>       static Wednesday = new DayOfWeek( { dayIndex: 2 });
>       static Thursday = new DayOfWeek( { dayIndex: 3 });
>       static Friday = new DayOfWeek( { dayIndex: 4 });
>       static Saturday = new DayOfWeek( { dayIndex: 5, isWeekend: true });
>       static Sunday = new DayOfWeek( { dayIndex: 6, isWeekend: true });
>     }
>
>     describe("DayOfWeek", () => {
>       test("should support full enum capabilities", function() {
>         // // custom methods
>         let dowSymbols = DayOfWeek.getSymbols();
>         expect(dowSymbols.length).toBe(7);
>         expect(DayOfWeek.Monday.nextDay()).toBe(DayOfWeek.Tuesday);
>         expect(DayOfWeek.Sunday.nextDay()).toBe(DayOfWeek.Monday);
>       // // custom properties
>         expect(DayOfWeek.Tuesday.isWeekend).toBe(undefined);
>         expect(DayOfWeek.Saturday.isWeekend).toBe(true);
>       // // Standard enum capabilities
>         expect(DayOfWeek.Thursday instanceof DayOfWeek).toBe(true);
>         expect(BreezeEnum.isSymbol(DayOfWeek.Wednesday)).toBe(true);
>         expect(DayOfWeek.contains(DayOfWeek.Thursday)).toBe(true);
>         expect(DayOfWeek.Friday.toString()).toBe("Friday");
>       });
>   });
Each enum module calls `resolveSymbols()` at import time. Until v3 those calls were written as
`Error['x'] = MyEnum.resolveSymbols()`, to keep a bundler from discarding a call whose result
nothing uses. That is no longer needed: `package.json` declares every module but the entity-graph
mixin side-effect free, so a module is kept exactly when something uses one of its exports - and
whatever needs the resolved symbols does. See the sideEffects section of CHANGES-DEV.md.
*/
export class BreezeEnum {
  // // TODO: think about CompositeEnum (flags impl).
  /** The name of this symbol */
  declare name: string;
  /** Type of the enum; set in prototype of each enum */
  declare _$typeName: string;
  /** @hidden @internal */
  static _resolvedNamesAndSymbols: { name: string, symbol: BreezeEnum }[];

  /**  */
  constructor(propertiesObj?: Object) {
    if (propertiesObj) {
      const self = this as Record<string, any>, props = propertiesObj as Record<string, any>;
      Object.keys(props).forEach((key) => self[key] = props[key]);
    }
  }

  /**
  Returns all of the symbols contained within this Enum.
  >     let symbols = DayOfWeek.getSymbols();
  @returns All of the symbols contained within this Enum.
  **/
  static getSymbols<T extends typeof BreezeEnum>(this: T): InstanceType<T>[] {
    // Typed through `this` so a subclass gets its own instances: FilterQueryOp.getSymbols() is
    // FilterQueryOp[], not BreezeEnum[]. The example above depends on that - nextDay() returns a
    // DayOfWeek - and so does passing a symbol to anything that wants the specific enum.
    return this.resolveSymbols().map(ks => ks.symbol) as InstanceType<T>[];
  }

  /**
  Returns the names of all of the symbols contained within this Enum.
  >     let symbols = DayOfWeek.getNames();
  @returns  All of the names of the symbols contained within this Enum.
  **/
  static getNames() {
    return this.resolveSymbols().map(ks => ks.name);
  }

  /**
  Returns an Enum symbol given its name.
  >     let dayOfWeek = DayOfWeek.from("Thursday");
  >     // nowdayOfWeek === DayOfWeek.Thursday
  @param name - Name for which an enum symbol should be returned.
  @returns The symbol that matches the name or 'undefined' if not found.
  **/
  static fromName(name: string) {
    return (this as Record<string, any>)[name];
  }

  /**
  Seals this enum so that no more symbols may be added to it. This should only be called after all symbols
  have already been added to the Enum. This method also sets the 'name' property on each of the symbols.
  >     DayOfWeek.resolveSymbols();
  **/
  static resolveSymbols() {
    if (this._resolvedNamesAndSymbols) return this._resolvedNamesAndSymbols;
    let result: {name: string, symbol: BreezeEnum }[] = [];

    const self = this as unknown as Record<string, any>;
    for (let key in this) {
      if (this.hasOwnProperty(key)) {
        let symb = self[key];
        if (symb instanceof BreezeEnum) {
          result.push( { name: key, symbol: symb });
          self[key] = symb;
          symb.name = key;
        }
      }
    }
    this._resolvedNamesAndSymbols = result;
    return result;
  }

  /**
  Returns whether an Enum contains a specified symbol.
  >     let symbol = DayOfWeek.Friday;
  >     if (DayOfWeek.contains(symbol)) {
  >         // do something
  >     }
  @param sym - Object or symbol to test.
  @returns Whether this Enum contains the specified symbol.
  **/
  static contains(sym: BreezeEnum) {
    if (!(sym instanceof BreezeEnum)) {
      return false;
    }

    return (this as Record<string, any>)[sym.name] != null;
  }


  // /**
  // Checks if an object is an Enum 'symbol'. Use the 'contains' method instead of this one 
  // if you want to test for a specific Enum. 
  // >     if (Enum.isSymbol(DayOfWeek.Wednesday)) {
  // >       // do something ...
  // >     };
  // **/
  // static isSymbol(obj: any) {
  //   return obj instanceof BreezeEnum;
  // };

  /** Returns the string name of this Enum */
  toString() {
    return this.name;
  }

  /** Return enum name and symbol name */
  toJSON() {
    return {
      _$typeName: this['_$typeName'] || (this.constructor as any).name,
      name: this.name
    };
  }

}


