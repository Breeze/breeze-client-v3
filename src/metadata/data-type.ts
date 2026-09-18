import { core, getUuid } from '../core/core.js';
import { BreezeEnum } from '../core/enum.js';
import { Validator } from '../validation/validate.js';

// A date-time with no zone that ends in fractional seconds, of any length: Json.NET drops trailing
// zeros, so 500 ms is ".5". It used to be /.\d{3}$/, which needed three digits and, with its
// unescaped dot, also matched an offset written without a colon ("+0200").
const _fractionalSecondsRegex = /\d\d\.\d+$/;

// Names the .NET servers can write in metadata for types the client knows by another name.
// EF Core writes the CLR type name (MetadataBuilder.NormalizeDataTypeName); NHibernate its own type names.
const _dataTypeAliases: Record<string, string> = {
  TimeSpan: "Time",
  Char: "String",
  SByte: "Int16",
  UInt16: "Int32",
  UInt32: "Int64",
  UInt64: "Int64",
  AnsiString: "String",  // NHibernate
  AnsiChar: "String",    // NHibernate
  StringClob: "String",  // NHibernate
};

/**  
DataType is an 'Enum' containing all of the supported data types.
*/
export class DataType extends BreezeEnum {
  /** The default value of this DataType. __Read Only__ */
  declare defaultValue?: any;
  /** Whether this is a 'numeric' DataType. __Read Only__ */
  declare isNumeric?: boolean;
  /** Whether this is an 'integer' DataType. __Read Only__ */
  declare isInteger?: boolean;

  /** The constructor function to create a {@link Validator} to be used in validating instances of this DataType. */
  validatorCtor?(context?: any): Validator;
  /** 
  Optional function to normalize a data value for comparison, if its value cannot be used directly. 
  Note that this will be called each time a property is changed, so make it fast.
  @returns value appropriate for this DataType
  */
  normalize?(value: any): any;
  /**
  Optional function to convert a raw (server) value from string to this DataType.
  @returns value appropriate for this DataType
  */
  parseRawValue?(value: any): any;
  /**
  Optional function to convert a value from string to this DataType.  Note that this will be called each time a property is changed, so make it fast.
  @returns value appropriate for this DataType 
  */
  parse?(source: any, sourceTypeName: string): any;
  /** 
  Optional function to get the next value for key generation, if this datatype is used as a key.  Uses an internal table of previous values.
  @returns value appropriate for this DataType 
  */
  getNext?(): any;
  /**
  Optional function to get the next value when the datatype is used as a concurrency property.
  @param previousValue
  @returns the next concurrency value, which may be a function of the previousValue.
  */
  getConcurrencyValue?(previousValue?: any): any;

  /**
  The function Breeze converts `DateTime` and `DateTimeOffset` values from the server with, when it
  materializes query and save results. Defaults to {@link DataType.parseDateAsUTC}. Replace it at
  startup, before the first query, to change how a date-time string with no offset is read - for
  example with {@link DataType.parseDateAsLocal}. It does not affect saves, which always send UTC.
  */
  static parseDateFromServer = (value: any) => DataType.parseDateAsUTC(value);
  // same effect as above but doesn't give right TSDOC.
  // static parseDateFromServer = DataType.parseDateAsUTC;

  /** @hidden @internal */
  static constants: { stringPrefix: string, nextNumber: number, nextNumberIncrement: number };

  /** A string (.NET `String`; also `Char`). Default `""`. */
  static String = new DataType({
    defaultValue: "",
    parse: coerceToString,
    getNext: getNextString
  });

  /** A 64-bit integer (.NET `Int64`; also `UInt32` and `UInt64`), held as a JavaScript `number`, so values beyond ±2^53 lose precision. Default `0`. */
  static Int64 = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
    getNext: getNextNumber
  });

  /** A 32-bit integer (.NET `Int32`; also `UInt16`), held as a `number`. Default `0`. */
  static Int32 = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
    getNext: getNextNumber
  });

  /** A 16-bit integer (.NET `Int16`; also `SByte`), held as a `number`. Default `0`. */
  static Int16 = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
    getNext: getNextNumber
  });

  /** An unsigned 8-bit integer, 0 to 255 (.NET `Byte`), held as a `number`. Default `0`. */
  static Byte = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
  });

  /** A decimal number (.NET `Decimal`), held as a JavaScript `number` - a double - so digits beyond its precision are lost. Default `0`. */
  static Decimal = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isFloat: true,
    parse: coerceToFloat,
    getNext: getNextNumber
  });

  /** A 64-bit floating-point number (.NET `Double`). Also the type Breeze infers for an unmapped property that holds a number. Default `0`. */
  static Double = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isFloat: true,
    parse: coerceToFloat,
    getNext: getNextNumber
  });

  /** A 32-bit floating-point number (.NET `Single`), held as a `number`. Default `0`. */
  static Single = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isFloat: true,
    parse: coerceToFloat,
    getNext: getNextNumber
  });

  /** A calendar date with no time (.NET `DateOnly`), held as a `Date` at local midnight. Read from the first ten characters (`YYYY-MM-DD`) of the server's value, sent back as `YYYY-MM-DD` from the local date, and compared by date alone. Default 1 January 1900. */
  static DateOnly = new DataType({
    defaultValue: new Date(1900, 0, 1),
    isDate: true,
    parse: coerceToDateOnly,
    parseRawValue: parseRawDateOnly,
    normalize: normalizeDateOnly, // dates don't perform equality comparisons properly
    getNext: getNextDateTime,
    getConcurrencyValue: getConcurrencyDateTime
  });

  /** A date and time (.NET `DateTime`), held as a `Date`. Read from the server with {@link DataType.parseDateFromServer} and sent as ISO 8601 in UTC. Also the type Breeze infers for an unmapped property that holds a `Date`. Default 1 January 1900, local midnight. */
  static DateTime = new DataType({
    defaultValue: new Date(1900, 0, 1),
    isDate: true,
    parse: coerceToDate,
    parseRawValue: parseRawDate,
    normalize: function (value: any) { return value && value.getTime && value.getTime(); }, // dates don't perform equality comparisons properly
    getNext: getNextDateTime,
    getConcurrencyValue: getConcurrencyDateTime
  });

  /** A date and time with an offset (.NET `DateTimeOffset`), held as a `Date`, which has no offset: it is read with {@link DataType.parseDateFromServer} and sent back in UTC, so the original offset is lost. Default 1 January 1900, local midnight. */
  static DateTimeOffset = new DataType({
    defaultValue: new Date(1900, 0, 1),
    isDate: true,
    parse: coerceToDate,
    parseRawValue: parseRawDate,
    normalize: function (value: any) { return value && value.getTime && value.getTime(); }, // dates don't perform equality comparisons properly
    getNext: getNextDateTime,
    getConcurrencyValue: getConcurrencyDateTime
  });

  /** A duration (.NET `TimeSpan`), held as the ISO 8601 duration string the server sends, such as `PT4H30M`. Compared as a number of seconds in local queries. Default `PT0S`. */
  static Time = new DataType({
    defaultValue: "PT0S",
    // Looked up on each call, not captured here, so that replacing parseTimeFromServer works.
    parseRawValue: (value: any) => DataType.parseTimeFromServer(value)
  });

  /** A time of day (.NET `TimeOnly`), held as the string the server sends: "14:30:00" or "01:23:45.678". */
  static TimeOnly = new DataType({
    defaultValue: "00:00:00"
  });

  /** A `true` or `false` value (.NET `Boolean`). Default `false`. */
  static Boolean = new DataType({
    defaultValue: false,
    parse: coerceToBool,
  });

  /** A GUID (.NET `Guid`), held as a lower-case string. Default `"00000000-0000-0000-0000-000000000000"`. */
  static Guid = new DataType({
    defaultValue: "00000000-0000-0000-0000-000000000000",
    parse: coerceToGuid,
    getNext: getNextGuid,
    parseRawValue: function (val: string) { return val.toLowerCase(); },
    getConcurrencyValue: getUuid
  });

  /** Binary data (.NET `byte[]`), such as a SQL `rowversion`, held as the base64 string the server sends. Default `null`. */
  static Binary = new DataType({
    defaultValue: null,
    parseRawValue: parseRawBinary
  });

  /** An unknown type: a server type name the client does not recognize (the original is kept in the property's `rawTypeName`), or an unmapped property whose type cannot be inferred. Values are not converted or validated. Default `undefined`. */
  static Undefined = new DataType({
    defaultValue: undefined,
  });

  /**
  Returns the function Breeze uses to turn values of a data type into something `===`, `<` and `>`
  compare correctly, in local queries and when ordering: the data type's `normalize` if it has one,
  a conversion to seconds for {@link DataType.Time}, and otherwise the value itself. Applications do
  not normally need it.
  @param dataType - The data type of the values to compare.
  */
  static getComparableFn(dataType?: DataType) {
    if (dataType && dataType.normalize) {
      return dataType.normalize;
    } else if (dataType === DataType.Time) {
      // durations must be converted to compare them
      return function (value: any) {
        return value && core.durationToSeconds(value);
      };
    } else {
      // TODO: __identity
      return function (value: any) {
        return value;
      };
    }
  }

  /**
  Returns the DataType with the specified name, or undefined if there is none. Also accepts the names the .NET
  servers use for some types, such as 'TimeSpan' for {@link DataType.Time}.
  */
  static fromName(name: string): DataType | undefined {
    const dt = super.fromName(name) || super.fromName(_dataTypeAliases[name]);
    return dt instanceof DataType ? dt : undefined;
  }

  /** Returns the DataType for a specified input. */
  static fromValue(val: any) {
    if (core.isDate(val)) return DataType.DateTime;
    switch (typeof val) {
      case "string":
        if (core.isGuid(val)) return DataType.Guid;
        // the >3 below is a hack to insure that if we are inferring datatypes that
        // very short strings that are valid but unlikely ISO encoded Time's are treated as strings instead.
        else if (core.isDuration(val) && val.length > 3) return DataType.Time;
        else if (core.isDateString(val)) return DataType.DateTime;
        return DataType.String;
      case "boolean":
        return DataType.Boolean;
      case "number":
        return DataType.Double;
    }
    return DataType.Undefined;
  }

  /**
  Converts a {@link DataType.Time} value from the server. By default it returns the value unchanged:
  a `Time` is held as the ISO 8601 duration string the server sends, such as `PT4H30M`. Replace it
  at startup, before the first query, to hold durations some other way - as a number of seconds,
  say, with {@link core.durationToSeconds}.
  */
  static parseTimeFromServer(source: any) {
    return source;
  }

  /**
  Converts a date-time string from the server to a `Date`. This is the default
  {@link DataType.parseDateFromServer}.
  - A string with `Z` or an offset (`2024-03-15T10:30:00Z`, `...10:30:00+02:00`) is read as given.
  - A string with no offset that ends in fractional seconds, of any length
    (`2024-03-15T10:30:00.5`, `...00.000`, `...00.1234567`), is read as UTC: Breeze appends `Z`.
  - Any other string with no offset, such as `2024-03-15T10:30:00`, goes to `Date.parse`
    unchanged, which reads it as **local** time.
  @param source - The value from the server.
  */
  static parseDateAsUTC(source: any) {
    if (typeof source === 'string') {
      // No zone but fractional seconds: the server wrote UTC without saying so. Append the Z.
      if (_fractionalSecondsRegex.test(source)) source = source + 'Z';
    }
    source = new Date(Date.parse(source));
    return source;
  }

  /** Parse as UTC then shift to local time */
  static parseDateAsLocal(source: string) {
    var dt = DataType.parseDateAsUTC(source);
    if (core.isDate(dt)) {
        dt = new Date(dt.getTime() + dt.getTimezoneOffset()*60000);
    }
    return dt;
  };

  /** if val is a Date, return a date-only string e.g. '2023-12-31' */
  static toDateOnlyString(val: any) {
    // DateOnly types should not have time component, but JSON.stringify makes a full ISO string.
    // We convert it to string here to prevent that, and shift the time zone because toISOString converts to UTC.
    return val && val.getTime && new Date(val.getTime() - val.getTimezoneOffset()*60000).toISOString().substring(0, 10) || val;
  }

  /** Returns a raw value converted to the specified DataType */
  static parseRawValue(val: any, dataType?: DataType) {
    // undefined values will be the default for most unmapped properties EXCEPT when they are set
    // in a jsonResultsAdapter ( an unusual use case).
    if (val === undefined) return undefined;
    if (!val) return val;
    if (dataType && dataType.parseRawValue) {
      val = dataType.parseRawValue(val);
    }
    return val;
  }

  /** @hidden @internal */
  // used during initialization; visible on instance for testing purposes.
  static _resetConstants() {
    DataType.constants = {
      stringPrefix: "K_",
      nextNumber: -1,
      nextNumberIncrement: -1
    };
  }

}
DataType.prototype._$typeName = "DataType";
DataType._resetConstants();
DataType.resolveSymbols();
DataType.getSymbols().forEach((sym: DataType) => sym.validatorCtor = getValidatorCtor(sym));

// private functions;


function getValidatorCtor(dataType: DataType) {
  switch (dataType) {
    case DataType.String:
      return Validator.string;
    case DataType.Int64:
      return Validator.int64;
    case DataType.Int32:
      return Validator.int32;
    case DataType.Int16:
      return Validator.int16;
    case DataType.Decimal:
      return Validator.number;
    case DataType.Double:
      return Validator.number;
    case DataType.Single:
      return Validator.number;
    case DataType.DateTime:
      return Validator.date;
    case DataType.DateTimeOffset:
      return Validator.date;
    case DataType.DateOnly:
      return Validator.date;
    case DataType.Boolean:
      return Validator.bool;
    case DataType.Guid:
      return Validator.guid;
    case DataType.Byte:
      return Validator.byte;
    case DataType.Binary:
      // TODO: don't quite know how to validate this yet.
      return Validator.none;
    case DataType.Time:
      return Validator.duration;
    case DataType.TimeOnly:
      return timeOnlyValidator;
    case DataType.Undefined:
      return Validator.none;
  }
}

/** A .NET TimeOnly as the server writes and reads it: "HH:mm", "HH:mm:ss" or "HH:mm:ss.fffffff". */
function timeOnlyValidator(context?: any) {
  return Validator.regularExpression({ ...context, expression: "^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d{1,7})?)?$" });
}

/** Local midnight on the day of a DateOnly value, so that values on the same day compare equal and order correctly. */
function normalizeDateOnly(value: any) {
  if (!(value && value.getTime)) return value;
  const day = new Date(value.getTime());
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function getNextString() {
  return DataType.constants.stringPrefix + getNextNumber().toString();
}

function getNextNumber() {
  let result = DataType.constants.nextNumber;
  DataType.constants.nextNumber += DataType.constants.nextNumberIncrement;
  return result;
}

function getNextGuid() {
  return getUuid();
}

function getNextDateTime() {
  return new Date();
}

function getConcurrencyDateTime(val: any) {
  // use the current datetime but insure that it is different from previous call.
  let dt = new Date();
  let dt2 = new Date();
  while (dt.getTime() === dt2.getTime()) {
    dt2 = new Date();
  }
  return dt2;
}

function coerceToString(source: any, sourceTypeName?: string) {
  return (source == null) ? source : source.toString();
}

function coerceToGuid(source: any, sourceTypeName: string) {
  if (sourceTypeName === "string") {
    return source.trim().toLowerCase();
  }
  return source;
}

function coerceToInt(source: any, sourceTypeName: string) {
  if (sourceTypeName === "string") {
    let src = source.trim();
    if (src === "") return null;
    let val = parseInt(src, 10);
    return isNaN(val) ? source : val;
  } else if (sourceTypeName === "number") {
    return Math.round(source);
  }
  // do we want to coerce floats -> ints
  return source;
}

function coerceToFloat(source: any, sourceTypeName: string) {
  if (sourceTypeName === "string") {
    let src = source.trim();
    if (src === "") return null;
    let val = parseFloat(src);
    return isNaN(val) ? source : val;
  }
  return source;
}

function coerceToDate(source: any, sourceTypeName: string) {
  let val: any;
  if (sourceTypeName === "string") {
    let src = source.trim();
    if (!source || !source.trim()) { return null; }
    val = new Date(Date.parse(src));
    return core.isDate(val) ? val : source;
  } else if (sourceTypeName === "number") {
    val = new Date(source);
    return core.isDate(val) ? val : source;
  }
  return source;
}

/** Trim off time portion before parse if source is string */
function coerceToDateOnly(source: any, sourceTypeName: string) {
  let val: any;
  if (sourceTypeName === "string") {
    if (!source || !source.trim()) { return null; }
    val = DataType.parseDateAsLocal(source);
    return core.isDate(val) ? val : source;
  } else if (sourceTypeName === "number") {
    val = new Date(source);
    return core.isDate(val) ? val : source;
  }
  return source;
}

function coerceToBool(source: any, sourceTypeName: string) {
  if (sourceTypeName === "string") {
    let src = source.trim().toLowerCase();
    if (src === "false" || src === "") {
      return false;
    } else if (src === "true") {
      return true;
    } else {
      return source;
    }
  }
  return source;
}


function parseRawDate(val: any) {
  if (!core.isDate(val)) {
    val = DataType.parseDateFromServer(val);
  }
  return val;
}

/** Trim off time portion before parse */
function parseRawDateOnly(val: any) {
  if (typeof val === 'string') {
    if (val.length > 10) {
      val = val.substring(0, 10);
    }
    val = DataType.parseDateAsLocal(val);
  }
  return val;
}

function parseRawBinary(val: any) {
  if (val && val.$value !== undefined) {
    val = val.$value; // this will be a byte[] encoded as a string
  }
  return val;
}

//function hasTimeZone(source) {
//  var ix = source.indexOf("T");
//  var timePart = source.substring(ix+1);
//  return  timePart.indexOf("-") >= 0 || timePart.indexOf("+") >= 0 || timePart.indexOf("Z");
//}
