/** See if this comment will make it into .d.ts */
import { BreezeEnum } from './enum.js';

/** The success callback accepted by the deprecated callback form of the async methods.
@deprecated Await the returned promise instead of passing callbacks. */
export interface Callback {
    (data: any): void;
}

// type Predicate = (i: any) => boolean;
type Predicate<T> = (i: T) => boolean;

/**
 * The helpers below are exported by name as well as on `core`, so that Breeze can use them
 * without going through a member it tells applications not to use. Several `core` members are
 * now exactly a built-in, and are marked `@deprecated` on the `core` object for that reason;
 * nothing inside Breeze reads them through `core` any more.
 * @hidden @internal
 */

// Both of these were built with an `uncurry` helper - `Function.call.apply(fn, arguments)` -
// which is how you borrowed a prototype method before the language had a way to say it.
/** @hidden @internal */
export const hasOwnProperty: (obj: Object, key: string) => boolean = Object.hasOwn;
/** @hidden @internal */
export const arraySlice = (ar: any[], start?: number, end?: number): any[] =>
    Array.prototype.slice.call(ar, start, end);

/** An object being deliberately indexed by arbitrary string key.
    The exported signatures below keep `Object` on purpose: narrowing them to this type
    would reject the class instances callers pass, because class types have no index
    signature. The cast is confined to the one line that needs it. */
type Indexed = Record<string, any>;

// NOTE: the `|| {}` on every Object.keys call below is load-bearing. These helpers are
// called with null and undefined by design; the `for...in` loops they replaced treated
// that as a no-op, whereas Object.keys(null) throws.

// iterate over object
function objectForEach(obj: Object, kvFn: (key: string, val: any) => any) {
    const rec = obj as Indexed;
    for (const key of Object.keys(rec || {})) {
        kvFn(key, rec[key]);
    }
}

function objectMap(obj: Object, kvFn?: (key: string, val: any) => any): any[] {
    const rec = obj as Indexed;
    let results: any[] = [];
    for (const key of Object.keys(rec || {})) {
        let result = kvFn ? kvFn(key, rec[key]) : rec[key];
        if (result !== undefined) {
            results.push(result);
        }
    }
    return results;
}

function objectFirst(obj: Object, kvPredicate: (key: string, val: any) => boolean): { key: string, value: any } | null {
    const rec = obj as Indexed;
    for (const key of Object.keys(rec || {})) {
        let value = rec[key];
        if (kvPredicate(key, value)) {
            return { key: key, value: value };
        }
    }
    return null;
}

/** @hidden @internal */
export function arrayFlatMap<T, U>(arr: T[], mapFn: (arg: T) => U[]): U[] {
    return arr.flatMap(mapFn);
}

function isSettable(obj: Object, propertyName: string): boolean {
    let pd = getPropDescriptor(obj, propertyName);
    if (pd == null) return true;
    return !!(pd.writable || pd.set);
}

function getPropDescriptor(obj: Object, propertyName: string): PropertyDescriptor | undefined {
    if (obj.hasOwnProperty(propertyName)) {
        return Object.getOwnPropertyDescriptor(obj, propertyName);
    } else {
        let nextObj = Object.getPrototypeOf(obj);
        if (nextObj == null) return undefined;
        return getPropDescriptor(nextObj, propertyName);
    }
}

// Functional extensions

/** can be used like: persons.filter(propEq("firstName", "John")) */
function propEq(propertyName: string, value: any): (obj: Object) => boolean {
    return function (obj: any) {
        return obj[propertyName] === value;
    };
}

/** can be used like: persons.filter(propEq("firstName", "FirstName", "John")) */
function propsEq(property1Name: string, property2Name: string, value: any): (obj: Object) => boolean {
    return function (obj: any) {
        return obj[property1Name] === value || obj[property2Name] === value;
    };
}

/** can be used like persons.map(pluck("firstName")) */
function pluck(propertyName: any): (obj: Object) => any {
    return function (obj: any) {
        return obj[propertyName];
    };
}

// end functional extensions

/** Return an array of property values from source */
function getOwnPropertyValues(source: Object): any[] {
    const rec = source as Indexed;
    let result: any[] = [];
    for (const name of Object.keys(rec || {})) {
        result.push(rec[name]);
    }
    return result;
}

/** Copy properties from source to target. Returns target. */
function extend(target: Object, source?: Object, propNames?: string[]): Object {
    if (!source) return target;
    const tgt = target as Indexed, src = source as Indexed;
    if (propNames) {
        propNames.forEach(function (propName) {
            tgt[propName] = src[propName];
        });
    } else {
        for (const propName of Object.keys(src || {})) {
            tgt[propName] = src[propName];
        }
    }
    return target;
}

/** Copy properties from defaults iff undefined on target.  Returns target. */
function updateWithDefaults(target: Object, defaults: Object): any {
    const tgt = target as Indexed, def = defaults as Indexed;
    for (const name of Object.keys(def || {})) {
        if (tgt[name] === undefined) {
            tgt[name] = def[name];
        }
    }
    return target;
}

/** Set ctor.defaultInstance to an instance of ctor with properties from target.
    We want to insure that the object returned by ctor.defaultInstance is always immutable
    Use 'target' as the primary template for the ctor.defaultInstance;
    Use current 'ctor.defaultInstance' as the template for any missing properties
    creates a new instance for ctor.defaultInstance
    returns target unchanged */
function setAsDefault(target: Object, ctor: { new (...args: any[]): any, defaultInstance?: any }): any {
    ctor.defaultInstance = updateWithDefaults(new ctor(target), ctor.defaultInstance);
    return target;
}

/**
    'source' is an object that will be transformed into another
    'template' is a map where the
       keys: are the keys to return
         if a key contains ','s then the key is treated as a delimited string with first of the
         keys being the key to return and the others all valid aliases for this key
       'values' are either
           1) the 'default' value of the key
           2) a function that takes in the source value and should return the value to set
         The value from the source is then set on the target,
         after first passing thru the fn, if provided, UNLESS:
           1) it is the default value
           2) it is undefined ( nulls WILL be set)
    'target' is optional
       - if it exists then properties of the target will be set ( overwritten if the exist)
       - if it does not exist then a new object will be created as filled.
    'target is returned.
*/
function toJson(source: Object, template: Object, target: Object = {}): Object {

    const src = source as Indexed, tmpl = template as Indexed, tgt = target as Indexed;
    for (const key of Object.keys(tmpl || {})) {
        let aliases = key.split(",");
        let defaultValue = tmpl[key];
        // using some as a forEach with a 'break'
        aliases.some(function (propName) {
            if (!(propName in source)) return false;
            let value = src[propName];
            // there is a functional property defined with this alias ( not what we want to replace).
            if (typeof value === 'function') return false;
            // '==' is deliberate here - idea is that null or undefined values will never get serialized
            // if default value is set to null.
            // tslint:disable-next-line
            if (value == defaultValue) return true;
            if (Array.isArray(value) && value.length === 0) return true;
            if (typeof (defaultValue) === "function") {
                value = defaultValue(value);
            } else if (typeof (value) === "object") {
                if (value && value instanceof BreezeEnum) {
                    value = value.name;
                }
            }
            if (value === undefined) return true;
            tgt[aliases[0]] = value;
            return true;
        });
    }
    return target;
}

/** Replacer function for toJSONSafe, when serializing entities.  Excludes entityAspect and other internal properties. */
function toJSONSafeReplacer(prop: string, val: any) {
    if (prop === "entityAspect" || prop === "complexAspect" || prop === "entityType" || prop === "complexType"
        || prop === "getProperty" || prop === "setProperty"
        || prop === "constructor" || prop.charAt(0) === '_' || prop.charAt(0) === '$') return;
    return val;
}

/** Safely perform toJSON logic on objects with cycles. */
function toJSONSafe(obj: any, replacer?: (prop: string, value: any) => any): any {
    if (obj !== Object(obj)) return obj; // primitive value
    if (obj._$visited) return undefined;
    if (obj.toJSON) {
        let newObj = obj.toJSON();
        if (newObj !== Object(newObj)) return newObj; // primitive value
        if (newObj !== obj) return toJSONSafe(newObj, replacer);
        // toJSON returned the object unchanged.
        obj = newObj;
    }
    obj._$visited = true;
    let result: any;
    if (obj instanceof Array) {
        result = obj.map(function (o: any) {
            return toJSONSafe(o, replacer);
        });
    } else if (typeof (obj) === "function") {
        result = undefined;
    } else {
        result = {};
        for (let prop in obj) {
            if (prop === "_$visited") continue;
            let val = obj[prop];
            if (replacer) {
                val = replacer(prop, val);
                if (val === undefined) continue;
            }
            val = toJSONSafe(val, replacer);
            if (val === undefined) continue;
            result[prop] = val;
        }
    }
    delete obj._$visited;
    return result;
}

/** Resolves the values of a list of properties by checking each property in multiple sources until a value is found. */
function resolveProperties(sources: Object[], propertyNames: string[]): any {
    let r: Indexed = {};
    let length = sources.length;
    propertyNames.forEach(function (pn) {
        for (let i = 0; i < length; i++) {
            let src = sources[i] as Indexed;
            if (src) {
                let val = src[pn];
                if (val !== undefined) {
                    r[pn] = val;
                    break;
                }
            }
        }
    });
    return r;
}


// array functions

function toArray(item: any): any[] {
    if (item == null) {
        return [];
    } else if (Array.isArray(item)) {
        return item;
    } else {
        return [item];
    }
}

/** a version of Array.map that doesn't require an array, i.e. works on arrays and scalars. */
// function map<T, U>(items: T | T[], fn: (v: T, ix?: number) => U, includeNull?: boolean): U | U[] {
 function map<T>(items: T | T[], fn: (v: T, ix?: number) => any, includeNull?: boolean): any | any[] {
    // whether to return nulls in array of results; default = true;
    includeNull = includeNull == null ? true : includeNull;
    if (items == null) return items;
    // let result: U[];
    if (Array.isArray(items)) {
        let result: any[] = [];
        items.forEach(function (v: any, ix: number) {
            let r = fn(v, ix);
            if (r != null || includeNull) {
                result[ix] = r;
            }
        });
        return result;
    } else {
        let result = fn(items);
        return result;
    }

}

/** Return first element matching predicate */
function arrayFirst<T>(array: T[], predicate: Predicate<any>): T;
function arrayFirst<T>(array: T[], predicate: Predicate<T>) {
    for (let i = 0, j = array.length; i < j; i++) {
        if (predicate(array[i])) {
            return array[i];
        }
    }
    return null;
}

/** Return index of first element matching predicate */
function arrayIndexOf<T>(array: T[], predicate: Predicate<any>): number;
function arrayIndexOf<T>(array: T[], predicate: Predicate<T>): number {
    for (let i = 0, j = array.length; i < j; i++) {
        if (predicate(array[i])) return i;
    }
    return -1;
}

/** Add item if not already in array */
function arrayAddItemUnique<T>(array: T[], item: T) {
    let ix = array.indexOf(item);
    if (ix === -1) array.push(item);
}

/** Remove items from the array
 * @param array
 * @param predicateOrItem - item to remove, or function to determine matching item
 * @param shouldRemoveMultiple - true to keep removing after first match, false otherwise
 */
function arrayRemoveItem<T>(array: T[], predicateOrItem: T | Predicate<T> , shouldRemoveMultiple?: boolean) {
    let predicate = (isFunction(predicateOrItem) ? predicateOrItem : undefined) as Predicate<T>;
    let lastIx = array.length - 1;
    let removed = false;
    for (let i = lastIx; i >= 0; i--) {
        if (predicate ? predicate(array[i]) : (array[i] === predicateOrItem)) {
            array.splice(i, 1);
            removed = true;
            if (!shouldRemoveMultiple) {
                return true;
            }
        }
    }
    return removed;
}

/** Combine array elements using the callback.  Returns array with length == min(a1.length, a2.length) */
function arrayZip(a1: any[], a2: any[], callback: (x1: any, x2: any) => any): any[] {
    let result: any[] = [];
    let n = Math.min(a1.length, a2.length);
    for (let i = 0; i < n; ++i) {
        result.push(callback(a1[i], a2[i]));
    }
    return result;
}

//function arrayDistinct(array) {
//    array = array || [];
//    let result = [];
//    for (let i = 0, j = array.length; i < j; i++) {
//        if (result.indexOf(array[i]) < 0)
//            result.push(array[i]);
//    }
//    return result;
//}

// Not yet needed
//// much faster but only works on array items with a toString method that
//// returns distinct string for distinct objects.  So this is safe for arrays with primitive
//// types but not for arrays with object types, unless toString() has been implemented.
//function arrayDistinctUnsafe(array) {
//    let o = {}, i, l = array.length, r = [];
//    for (i = 0; i < l; i += 1) {
//        let v = array[i];
//        o[v] = v;
//    }
//    for (i in o) r.push(o[i]);
//    return r;
//}

function arrayEquals(a1: any[], a2: any[], equalsFn?: (x1: any, x2: any) => boolean): boolean {
    //Check if the arrays are undefined/null
    if (!a1 || !a2) return false;

    if (a1.length !== a2.length) return false;

    //go thru all the vars
    for (let i = 0; i < a1.length; i++) {
        //if the let is an array, we need to make a recursive check
        //otherwise we'll just compare the values
        if (Array.isArray(a1[i])) {
            if (!arrayEquals(a1[i], a2[i])) return false;
        } else {
            if (equalsFn) {
                if (!equalsFn(a1[i], a2[i])) return false;
            } else {
                if (a1[i] !== a2[i]) return false;
            }
        }
    }
    return true;
}

// end of array functions

/** Returns an array for a source and a prop, and creates the prop if needed. */
/** Returns the array stored under key, creating it if absent. Map counterpart of getArray. */
function getMapArray<K, V>(map: Map<K, V[]>, key: K): V[] {
    let arr = map.get(key);
    if (!arr) {
        arr = [];
        map.set(key, arr);
    }
    return arr;
}

/** Execute fn while obj has tempValue for property */
function using(obj: Object, property: string, tempValue: any, fn: () => any) {
    if (!obj) {
        return fn();
    }
    const rec = obj as Indexed;
    let originalValue = rec[property];
    if (tempValue === originalValue) {
        return fn();
    }
    rec[property] = tempValue;
    try {
        return fn();
    } finally {
        if (originalValue === undefined) {
            delete rec[property];
        } else {
            rec[property] = originalValue;
        }
    }
}

/** Call state = startFn(), call fn(), call endFn(state) */
function wrapExecution(startFn: () => any, endFn: (state: any) => any, fn: () => any) {
    let state: any;
    try {
        state = startFn();
        return fn();
    } catch (e) {
        if (typeof (state) === 'object') {
            state.error = e;
        }
        throw e;
    } finally {
        endFn(state);
    }
}

/** Remember & return the value of fn() when it was called with its current args */
function memoize(fn: any): any {
    return function () {
        let args = arraySlice(<any>arguments),
            hash = "",
            i = args.length,
            currentArg: any = null;
        while (i--) {
            currentArg = args[i];
            hash += (currentArg === Object(currentArg)) ? JSON.stringify(currentArg) : currentArg;
            fn.memoize || (fn.memoize = {});
        }
        return (hash in fn.memoize) ?
            fn.memoize[hash] :
            fn.memoize[hash] = fn.apply(this, args);
    };
}

const uuidrex = /[xy]/g;

/**
 * A version 4 UUID.
 *
 * `crypto.randomUUID()` where it exists, which is everywhere Breeze supports except a browser
 * outside a secure context - it is unavailable over plain HTTP. It is both properly random and
 * about 30x faster than building one out of `Math.random()`, which matters because this is what
 * names a new entity with a Guid key.
 *
 * The fallback is the old implementation. `Math.random()` is not a cryptographic source, so the
 * values it produces are unique enough for a client-side temporary key and should not be relied
 * on for anything else.
 * @hidden @internal
 */
export function getUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(uuidrex, function (c) {
        // tslint:disable-next-line
        let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const durationrex = /^P((\d+Y)?(\d+M)?(\d+D)?)?(T(\d+H)?(\d+M)?(\d+S)?)?$/;
const lettersrex = /[A-Za-z]+/g;
function durationToSeconds(duration: string) {
    // basic algorithm from https://github.com/nezasa/iso8601-js-period
    if (typeof duration !== "string") throw new Error("Invalid ISO8601 duration '" + duration + "'");

    // regex splits as follows - grp0, grp1, y, m, d, grp2, h, m, s
    //                           0     1     2  3  4  5     6  7  8
    let struct = durationrex.exec(duration);
    if (!struct) throw new Error("Invalid ISO8601 duration '" + duration + "'");

    let ymdhmsIndexes = [2, 3, 4, 6, 7, 8]; // -> grp1,y,m,d,grp2,h,m,s
    let factors = [31104000, // year (360*24*60*60)
        2592000,             // month (30*24*60*60)
        86400,               // day (24*60*60)
        3600,                // hour (60*60)
        60,                  // minute (60)
        1];                  // second (1)

    let seconds = 0;
    for (let i = 0; i < 6; i++) {
        let digit = struct[ymdhmsIndexes[i]];
        // remove letters, replace by 0 if not defined
        digit = <any>(digit ? +digit.replace(lettersrex, '') : 0);
        seconds += <any>digit * factors[i];
    }
    return seconds;

}

// is functions

function noop() {
    // does nothing
}

function identity(x: any): any {
    return x;
}

function classof(o: any) {
    if (o === null) {
        return "null";
    }
    if (o === undefined) {
        return "undefined";
    }
    return Object.prototype.toString.call(o).slice(8, -1).toLowerCase();
}

function isDate(o: any) {
    return classof(o) === "date" && !isNaN(o.getTime());
}

const isdaterex = /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/;
function isDateString(s: string) {
    // let rx = /^(\d{4}|[+\-]\d{6})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(?:(Z)|([+\-])(\d{2})(?::(\d{2}))?)?)?$/;
    return (typeof s === "string") && isdaterex.test(s);
}

function isFunction(o: any) {
    return classof(o) === "function";
}

// function isString(o: any) {
//     return (typeof o === "string");
// }

// function isObject(o: any) {
//     return (typeof o === "object");
// }

const isguidrex = /^[a-fA-F\d]{8}-(?:[a-fA-F\d]{4}-){3}[a-fA-F\d]{12}$/;
function isGuid(value: any) {
    return (typeof value === "string") && isguidrex.test(value);
}

const isdurationrex = /^(-|)?P[T]?[\d\.,\-]+[YMDTHS]/;
function isDuration(value: any) {
    return (typeof value === "string") && isdurationrex.test(value);
}

function isEmpty(obj: any) {
    if (obj === null || obj === undefined) {
        return true;
    }
    for (let key in obj) {
        if (hasOwnProperty(obj, key)) {
            return false;
        }
    }
    return true;
}

// end of is Functions

// string functions

// These two exist for their null handling, which is what the local query operators need: a
// property that is null does not start with anything, and comparing against a null prefix asks
// nothing. `String.prototype.startsWith` throws on the first and compares against the text
// "null" on the second. The comparison itself is the built-in now - `endsWith` is 2.3x the
// `indexOf` arithmetic it replaces.
/** @hidden @internal */
export function stringStartsWith(str: string, prefix: string) {
    // returns true for empty string or null prefix
    if ((!str)) return false;
    if (prefix === "" || prefix == null) return true;
    return str.startsWith(prefix);
}

/** @hidden @internal */
export function stringEndsWith(str: string, suffix: string) {
    // returns true for empty string or null suffix
    if ((!str)) return false;
    if (suffix === "" || suffix == null) return true;
    return str.endsWith(suffix);
}

// Based on fragment from Dean Edwards' Base 2 library
/** format("a %1 and a %2", "cat", "dog") -> "a cat and a dog" */
/**
 * Replaces `%1`, `%2`, ... in `str` with the arguments that follow it.
 *
 * It declared rest parameters and then read `arguments` anyway, and compiled a fresh `RegExp`
 * on every call to bound the placeholder to the number of arguments given - so `%3` with two
 * arguments was left in place rather than replaced. One shared pattern does the same thing:
 * a placeholder with no argument for it is left alone here too.
 * @hidden @internal
 */
export function formatString(str: string, ...params: any[]) {
    return str.replace(formatStringRex, (match, index) => {
        const param = params[Number(index) - 1];
        return param === undefined ? match : param;
    });
}
const formatStringRex = /%([1-9])/g;

// end of string functions


// strings for error messages

const strings = {
    "TO_TYPE": "Add 'EntityQuery.toType()' to your query, or call 'MetadataStore.setEntityTypeForResourceName()' to register an EntityType for this resourceName."
}

// // not all methods above are exported
export const core = {
    /** @deprecated Use `Object.hasOwn(obj, key)`, which this now calls. */
    hasOwnProperty: hasOwnProperty,
    getOwnPropertyValues: getOwnPropertyValues,
    getPropertyDescriptor: getPropDescriptor,
    objectForEach: objectForEach,
    objectFirst: objectFirst,
    objectMap: objectMap, // TODO: replace this with something strongly typed.
    extend: extend,
    propEq: propEq,
    propsEq: propsEq,
    pluck: pluck,
    map: map,
    resolveProperties: resolveProperties,
    setAsDefault: setAsDefault,
    updateWithDefaults: updateWithDefaults,
    getMapArray: getMapArray,
    toArray: toArray,
    arrayEquals: arrayEquals,
    /** @deprecated Use `arr.slice(start, end)`, or `Array.prototype.slice.call(arrayLike)` for
        an arguments object. That is what this now does. */
    arraySlice: arraySlice,
    arrayFirst: arrayFirst,
    arrayIndexOf: arrayIndexOf,
    arrayRemoveItem: arrayRemoveItem,
    arrayZip: arrayZip,
    arrayAddItemUnique: arrayAddItemUnique,
    /** @deprecated Use `arr.flatMap(fn)`, which this now calls. */
    arrayFlatMap: arrayFlatMap,

    using: using,
    wrapExecution: wrapExecution,

    memoize: memoize,
    /** @deprecated Use `crypto.randomUUID()`. This calls it where it exists and falls back to a
        `Math.random()` implementation in a browser outside a secure context, where it does not. */
    getUuid: getUuid,
    durationToSeconds: durationToSeconds,

    isSettable: isSettable,

    isDate: isDate,
    isDateString: isDateString,
    isGuid: isGuid,
    isDuration: isDuration,
    isFunction: isFunction,
    isEmpty: isEmpty,

    identity: identity,
    noop: noop,

    /** @deprecated Use `str.startsWith(prefix)`. Not quite the same: this answers `false` for a
        null string and `true` for a null prefix, where the built-in throws and compares against
        the text "null" respectively. Guard the null yourself. */
    stringStartsWith: stringStartsWith,
    /** @deprecated Use `str.endsWith(suffix)`, with the same caveat about nulls as
        {@link core.stringStartsWith}. */
    stringEndsWith: stringEndsWith,
    formatString: formatString,

    toJson: toJson,
    toJSONSafe: toJSONSafe,
    toJSONSafeReplacer: toJSONSafeReplacer,

    strings: strings
};

/** The failure callback accepted by the deprecated callback form of the async methods.
@deprecated Await the returned promise instead of passing callbacks. */
export interface ErrorCallback {
    (error: any): void;
}


// Unused
/*
// returns true for booleans, numbers, strings and dates
// false for null, and non-date objects, functions, and arrays
function isPrimitive(obj: any) {
    if (obj == null) return false;
    // true for numbers, strings, booleans and null, false for objects
    if (obj != Object(obj)) return true;
    return isDate(obj);
}

*/