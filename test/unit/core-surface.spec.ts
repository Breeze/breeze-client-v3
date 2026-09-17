import { core } from '../../src/breeze';

// `core` is a public export - `breeze.core` in 2.x - so what it holds is API, and a member
// leaving it is a breaking change. This pins the list so that adding or removing one is a
// deliberate act with a diff to review, rather than something that happens by accident while
// tidying up a helper.
//
// Five members were removed in 3.0, all of them written for a JavaScript that no longer needs
// them and none of them used anywhere in the library, its tests or its docs:
//
//   isES5Supported  a try/catch probe for Object.defineProperty
//   requireLib      found jQuery / Knockout / OData through browser globals or AMD require -
//                   all four were removed in 3.0, and this was the last thing in core.ts
//                   reaching for `window`
//   isNumeric       !isNaN(parseFloat(n)) && isFinite(n)
//   titleCase       camelCase to "Title Case"
//   getArray        superseded by getMapArray
//
// An `Object.create` polyfill went with them - a top-level assignment to a global, which is
// exactly what side-effects.spec.ts exists to keep out.

const MEMBERS = [
  // objects
  'hasOwnProperty', 'getOwnPropertyValues', 'getPropertyDescriptor',
  'objectForEach', 'objectFirst', 'objectMap', 'extend',
  'propEq', 'propsEq', 'pluck', 'map',
  'resolveProperties', 'setAsDefault', 'updateWithDefaults',
  // arrays
  'getMapArray', 'toArray', 'arrayEquals', 'arraySlice', 'arrayFirst', 'arrayIndexOf',
  'arrayRemoveItem', 'arrayZip', 'arrayAddItemUnique', 'arrayFlatMap',
  // control flow
  'using', 'wrapExecution', 'memoize',
  // values
  'getUuid', 'durationToSeconds', 'isSettable',
  // type tests
  'isDate', 'isDateString', 'isGuid', 'isDuration', 'isFunction', 'isEmpty',
  // functions
  'identity', 'noop',
  // strings
  'stringStartsWith', 'stringEndsWith', 'formatString',
  // json
  'toJson', 'toJSONSafe', 'toJSONSafeReplacer',
  'strings',
  // Not in core.ts's own object literal: assert-param.ts and config.ts assign these onto `core`
  // at import time, for 2.x code that reached them as `breeze.core.assertParam` and the like.
  // side-effects.spec.ts lists those assignments as deliberate exceptions.
  'Param', 'assertParam', 'assertConfig', 'config',
  'Event',   // event.ts assigns BreezeEvent here; 2.x code said `breeze.core.Event`
];

const REMOVED_IN_3 = ['isES5Supported', 'requireLib', 'isNumeric', 'titleCase', 'getArray'];

describe('core', () => {

  test('exposes exactly the documented members', () => {
    expect(Object.keys(core).sort()).toEqual([...MEMBERS].sort());
  });

  test.each(REMOVED_IN_3)('no longer exposes %s', (name) => {
    expect(name in core).toBe(false);
  });

  // The two that were built by borrowing a prototype method through an `uncurry` helper, and are
  // now the language's own. Same behaviour, and both are faster.
  describe('the two that became built-ins', () => {

    test('hasOwnProperty answers for own properties only', () => {
      const obj = { a: 1 };
      expect(core.hasOwnProperty(obj, 'a')).toBe(true);
      expect(core.hasOwnProperty(obj, 'b')).toBe(false);
      expect(core.hasOwnProperty(obj, 'toString')).toBe(false);   // inherited, not own
      expect(core.hasOwnProperty(Object.create({ inherited: 1 }), 'inherited')).toBe(false);
    });

    test('arraySlice copies a range, and copies array-likes', () => {
      expect(core.arraySlice([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
      expect(core.arraySlice([1, 2, 3, 4], 1)).toEqual([2, 3, 4]);
      expect(core.arraySlice([1, 2, 3, 4], 1, 3)).toEqual([2, 3]);
      expect(core.arraySlice([1, 2, 3, 4], -2)).toEqual([3, 4]);
      // it was built from Array.prototype.slice so that it works on arguments objects too
      expect(core.arraySlice({ 0: 'a', 1: 'b', length: 2 } as any)).toEqual(['a', 'b']);
    });
  });
});
