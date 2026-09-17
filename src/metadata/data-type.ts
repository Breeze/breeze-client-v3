import { core, getUuid } from '../core/core.js';
import { BreezeEnum } from '../core/enum.js';
import { Validator } from '../validation/validate.js';

let _localTimeRegex = /.\d{3}$/;

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
**/
export class DataType extends BreezeEnum {
  /** The default value of this DataType. __Read Only__ **/
  declare defaultValue?: any;
  /** Whether this is a 'numeric' DataType. __Read Only__ **/
  declare isNumeric?: boolean;
  /** Whether this is an 'integer' DataType. __Read Only__ **/
  declare isInteger?: boolean;

  /** The constructor function to create a {@link Validator} to be used in validating instances of this DataType. */
  validatorCtor?(context?: any): Validator;
  /** 
  Optional function to normalize a data value for comparison, if its value cannot be used directly. 
  Note that this will be called each time a property is changed, so make it fast.
  @returns value appropriate for this DataType
  **/
  normalize?(value: any): any;
  /**
  Optional function to convert a raw (server) value from string to this DataType.
  @returns value appropriate for this DataType
  **/
  parseRawValue?(value: any): any;
  /**
  Optional function to convert a value from string to this DataType.  Note that this will be called each time a property is changed, so make it fast.
  @returns value appropriate for this DataType 
  **/
  parse?(source: any, sourceTypeName: string): any;
  /** 
  Optional function to get the next value for key generation, if this datatype is used as a key.  Uses an internal table of previous values.
  @returns value appropriate for this DataType 
  **/
  getNext?(): any;
  /**
  Optional function to get the next value when the datatype is used as a concurrency property.
  @param previousValue
  @returns the next concurrency value, which may be a function of the previousValue.
  **/
  getConcurrencyValue?(previousValue?: any): any;

  static parseDateFromServer = (value: any) => DataType.parseDateAsUTC(value);
  // same effect as above but doesn't give right TSDOC.
  // static parseDateFromServer = DataType.parseDateAsUTC;

  /** @hidden @internal */
  static constants: { stringPrefix: string, nextNumber: number, nextNumberIncrement: number };

  static String = new DataType({
    defaultValue: "",
    parse: coerceToString,
    getNext: getNextString
  });

  static Int64 = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
    getNext: getNextNumber
  });

  static Int32 = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
    getNext: getNextNumber
  });

  static Int16 = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
    getNext: getNextNumber
  });

  static Byte = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isInteger: true,
    parse: coerceToInt,
  });

  static Decimal = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isFloat: true,
    parse: coerceToFloat,
    getNext: getNextNumber
  });

  static Double = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isFloat: true,
    parse: coerceToFloat,
    getNext: getNextNumber
  });

  static Single = new DataType({
    defaultValue: 0,
    isNumeric: true,
    isFloat: true,
    parse: coerceToFloat,
    getNext: getNextNumber
  });

  static DateOnly = new DataType({
    defaultValue: new Date(1900, 0, 1),
    isDate: true,
    parse: coerceToDateOnly,
    parseRawValue: parseRawDateOnly,
    normalize: normalizeDateOnly, // dates don't perform equality comparisons properly
    getNext: getNextDateTime,
    getConcurrencyValue: getConcurrencyDateTime
  });

  static DateTime = new DataType({
    defaultValue: new Date(1900, 0, 1),
    isDate: true,
    parse: coerceToDate,
    parseRawValue: parseRawDate,
    normalize: function (value: any) { return value && value.getTime && value.getTime(); }, // dates don't perform equality comparisons properly
    getNext: getNextDateTime,
    getConcurrencyValue: getConcurrencyDateTime
  });

  static DateTimeOffset = new DataType({
    defaultValue: new Date(1900, 0, 1),
    isDate: true,
    parse: coerceToDate,
    parseRawValue: parseRawDate,
    normalize: function (value: any) { return value && value.getTime && value.getTime(); }, // dates don't perform equality comparisons properly
    getNext: getNextDateTime,
    getConcurrencyValue: getConcurrencyDateTime
  });

  static Time = new DataType({
    defaultValue: "PT0S",
    parseRawValue: DataType.parseTimeFromServer
  });

  /** A time of day (.NET `TimeOnly`), held as the string the server sends: "14:30:00" or "01:23:45.678". */
  static TimeOnly = new DataType({
    defaultValue: "00:00:00"
  });

  static Boolean = new DataType({
    defaultValue: false,
    parse: coerceToBool,
  });

  static Guid = new DataType({
    defaultValue: "00000000-0000-0000-0000-000000000000",
    parse: coerceToGuid,
    getNext: getNextGuid,
    parseRawValue: function (val: string) { return val.toLowerCase(); },
    getConcurrencyValue: getUuid
  });

  static Binary = new DataType({
    defaultValue: null,
    parseRawValue: parseRawBinary
  });

  static Undefined = new DataType({
    defaultValue: undefined,
  });

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
  **/
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

  static parseTimeFromServer(source: any) {
    if (typeof source === 'string') {
      return source;
    }
    return source;
  }

  static parseDateAsUTC(source: any) {
    if (typeof source === 'string') {
      // convert to UTC string if no time zone specifier.
      let isLocalTime = _localTimeRegex.test(source);
      // var isLocalTime = !hasTimeZone(source);
      source = isLocalTime ? source + 'Z' : source;
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
