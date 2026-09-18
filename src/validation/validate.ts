import { core } from '../core/core.js';
import { assertParam } from '../core/assert-param.js';
import { config } from '../config/config.js';
import { NavigationProperty, DataProperty } from '../metadata/entity-metadata.js';
import { Entity } from '../entity/entity-aspect.js';

export const INT16_MIN = -32768;
export const INT16_MAX = 32767;

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

export const BYTE_MIN = 0;
export const BYTE_MAX = 255;

/** The entity and property being validated. The {@link ValidationMessageContext} passed to a {@link ValidationFn} extends it with the validator's settings. */
export interface ValidationContext {
  /** The entity whose property is being validated. Set when Breeze validates a property of an entity; an entity-level validator gets the entity as its value instead. */
  entity?: Entity;
  /** The {@link DataProperty} or {@link NavigationProperty} being validated. Set when Breeze validates a property. */
  property?: DataProperty | NavigationProperty;
  /** The name of the property being validated: a property path, such as `address.city`, for a property of a complex object. */
  propertyName?: string;
  /** The value that failed validation, so that a message template can show it as `%value%`. Set by {@link Validator.validate} when validation fails. */
  value?: any;
}

/** Used by Validator to compose messages */
export interface ValidationMessageContext extends ValidationContext {
  /** The name of the validator. Set by the {@link Validator} constructor. */
  name?: string;
  /** The name to show for the property in messages, as `%displayName%`. When it is not set, Breeze uses the property's `displayName`, or else `propertyName`, or `"Value"` when there is no property. */
  displayName?: string;
  /** The error message template. Each `%token%` is replaced with the context property of that name, calling it with the context if it is a function. Defaults to the entry for the validator's name in {@link Validator.messageTemplates}. */
  messageTemplate?: string;
  /** A message to use instead of `messageTemplate`: a string, or a function that returns one from the context. */
  message?: string | ((vc: ValidationContext) => string);
  [key:string]: any;
}

/** Function called to validate an entity or property. Breeze always passes a context: the
validator's own, with its settings, extended for each call with the entity and property being
validated - so a validator reads its settings from it, as `ctx.min`. */
export interface ValidationFn {
    (value: any, context: ValidationMessageContext): boolean;
}

// add common props and methods for every validator 'context' here.
let rootContext = {
  displayName: function (context: ValidationContext) {
    if (context.property) {
      return context.property.resolveProperty("displayName") || context.propertyName || context.property.name;
    } else {
      return "Value";
    }
  }
};

/**
Instances of the Validator class provide the logic to validate another object and provide a description of any errors
encountered during the validation process.  They are typically associated with a 'validators' property on the following types: {@link EntityType},
{@link DataProperty} or {@link NavigationProperty}.

Property-level validators normally arrive with the metadata. The Breeze server sends a
`validators` array for each data property - for example `required` for a non-nullable
property, `maxLength` for a string with a maximum length, and a data-type validator such as
`int32` or `date`. They are not inferred on the client, so metadata written by hand has
none unless you add them.

To write your own, construct one with a name, a validation function and a context. Several
basic "Validator" construction methods are also provided as static methods to this class. These methods
provide a simpler syntax for creating basic validations.

Many of these stock validators are inspired by and implemented to conform to the validators defined at
http://msdn.microsoft.com/en-us/library/system.componentmodel.dataannotations.aspx

Sometimes a custom validator will be required.
@example
Most validators will be 'property' level validators, like this.
@example
    // v in this function is the value to be validated, in this case a "country" string.
    const valFn = (v: string | null) => v == null || v.startsWith("US");
    const countryValidator = new Validator("countryIsUS", valFn, {
        displayName: "Country",
        messageTemplate: "'%displayName%' must start with 'US'"
    });

    // Now plug it into Breeze.
    // Assume em1 is a preexisting EntityManager.
    const custType = em1.metadataStore.getAsEntityType("Customer");
    const countryProp = custType.getProperty("country");
    // Note that validator is added to a 'DataProperty' validators collection.
    countryProp.validators.push(countryValidator);
Entity level validators are also possible
@example
    function isValidZipCode(value: string) {
        const re = /^\d{5}([\-]\d{4})?$/;
        return re.test(value);
    }

    // the value in this case will be a Customer entity
    const valFn = (cust: Customer) => {
        // This validator only validates US Zip Codes.
        if (cust.country === "USA") {
            return isValidZipCode(cust.postalCode);
        }
        return true;
    };
    const zipCodeValidator = new Validator("zipCodeValidator", valFn,
        { messageTemplate: "For the US, this is not a valid PostalCode" });

    // Now plug it into Breeze.
    // Assume em1 is a preexisting EntityManager.
    const custType = em1.metadataStore.getAsEntityType("Customer");
    // Note that validator is added to an 'EntityType' validators collection.
    custType.validators.push(zipCodeValidator);
What is commonly needed is a way of creating a parameterized function that will itself
return a new Validator.  This requires the use of a 'context' object.
@example
    // create a function that will take in a config object
    // and will return a validator
    const numericRangeValidator = (context: { min?: number, max?: number }) => {
        const valFn = (v: any, ctx: ValidationMessageContext) => {
            if (v == null) return true;
            if (typeof v !== "number") return false;
            if (ctx.min != null && v < ctx.min) return false;
            if (ctx.max != null && v > ctx.max) return false;
            return true;
        };
        // The last parameter below is the 'context' object that will be passed into the 'ctx' parameter above
        // when this validator executes. Several other properties, such as displayName will get added to this object as well.
        return new Validator("numericRange", valFn, {
            messageTemplate: "'%displayName%' must be a number between the values of %min% and %max%",
            min: context.min,
            max: context.max
        });
    };
    // Assume that freightProperty is a DataEntityProperty that describes numeric values.
    // register the validator
    freightProperty.validators.push(numericRangeValidator({ min: 100, max: 500 }));

Breeze substitutes context values and functions for the tokens in the messageTemplate when preparing the runtime error message;
'displayName' is a pre-defined context function that is always available.

Please note that Breeze substitutes the empty string for falsey parameters. That usually works in your favor.
Sometimes it doesn't as when the 'min' value is zero in which case the message text would have a hole
where the 'min' value goes, saying: "... an integer between the values of and ...". That is not what you want.

To avoid this effect, you may can bake certain of the context values into the 'messageTemplate' itself
as shown in this revision to the pertinent part of the previous example:
@example
    // ... as before
    // ... but bake the min/max values into the message template.
    const template = core.formatString(
        "'%displayName%' must be a number between the values of %1 and %2",
        context.min, context.max);
    return new Validator("numericRange", valFn, {
        messageTemplate: template,
        min: context.min,
        max: context.max
    });

@param name {String} The name of this validator.
@param validatorFn {Function} A function to perform validation.

validatorFn(value, context)
@param validatorFn.value {Object} Value to be validated
@param validatorFn.context {Object} The same context object passed into the constructor with the following additional properties if not
otherwise specified.
@param validatorFn.context.value {Object} The value being validated.
@param validatorFn.context.name {String} The name of the validator being executed.
@param validatorFn.context.displayName {String} This will be either the value of the property's 'displayName' property or
the value of its 'name' property or the string 'Value'
@param validatorFn.context.messageTemplate {String} This will either be the value of Validator.messageTemplates[ {this validators name}] or null. Validator.messageTemplates
is an object that is keyed by validator name and that can be added to in order to 'register' your own message for a given validator.
The following property can also be specified for any validator to force a specific errorMessage string
@param [validatorFn.context.message] {String} If this property is set it will be used instead of the 'messageTemplate' property when an
error message is generated.

@param [context] {Object} A free form object whose properties will made available during the validation and error message creation process.
This object will be passed into the Validator's validation function whenever 'validate' is called. See above for a description
of additional properties that will be automatically added to this object if not otherwise specified.
*/
export class Validator {
  /** @hidden @internal */
  declare _$typeName: string; // on proto

  /** The name of this validator, such as `required` or `maxLength`. It picks the default message template and forms part of each {@link ValidationError}'s key. __Read Only__ */
  declare name: string;
  /** The function that performs the validation. It returns `true` if the value is valid. __Read Only__ */
  declare valFn: ValidationFn;
  /** The context this validator was created with, plus `name`, `messageTemplate` and a `displayName` function. It is passed to `valFn` and used to compose error messages. __Read Only__ */
  declare context: ValidationMessageContext;
  /** The context of the most recent call to {@link Validator.validate}: `context` extended with any additional context passed to it. {@link Validator.getMessage} reads it. After a validation that passed, it is `context` again. __Read Only__ */
  declare currentContext: ValidationMessageContext;
  declare private _baseContext: ValidationMessageContext;

  /** Creates a validator. See the class description for examples.
  @param name - The validator's name. Also the default `key` of the errors it produces.
  @param valFn - The function that validates: called with the value (or, for an entity-level
    validator, the entity) and the context, it returns whether the value is valid.
  @param context - Settings for the validator and its messages, such as `displayName` and
    `messageTemplate`. They are available to `valFn` and to the error message template.
  */
  constructor(name: string, valFn: ValidationFn, context?: ValidationMessageContext) {
    // _baseContext is what will get serialized
    this._baseContext = context || {} as ValidationMessageContext;
    this._baseContext.name = name;
    context = core.extend(Object.create(rootContext), this._baseContext) as ValidationMessageContext;
    context.messageTemplate = context.messageTemplate || Validator.messageTemplates[name];
    this.name = name;
    this.valFn = valFn;
    this.context = context;
  }

  /**
  Run this validator against the specified value.  This method will usually be called internally either
  automatically by an property change, entity attach, query or save operation, or manually as a result of
  a validateEntity call on the EntityAspect. The resulting ValidationResults are available via the
  EntityAspect.getValidationErrors method.

  However, you can also call a validator directly either for testing purposes or some other reason if needed.
  @example
      // using one of the predefined validators
      const validator = Validator.maxLength({ maxLength: 5, displayName: "City" });
      // null, because "asdf".length <= 5
      const noError = validator.validate("asdf");
      const result = validator.validate("adasdfasdf");
      // extract all of the properties of the 'result'
      const errMsg = result.errorMessage;
      const context = result.context;
      const sameValidator = result.validator;
  @param value {Object} Value to validate
  @param additionalContext {Object} Any additional contextual information that the Validator
  can make use of.
  @returns {ValidationError|null} A ValidationError if validation fails, null otherwise
  */
  validate(value: any, additionalContext?: ValidationMessageContext) {
    let currentContext: ValidationMessageContext; // { value?: Object };
    if (additionalContext) {
      currentContext = core.extend(Object.create(this.context), additionalContext) as ValidationMessageContext;
    } else {
      currentContext = this.context;
    }
    this.currentContext = currentContext;

    try {
      if (this.valFn(value, currentContext)) {
        // Drop the per-call context on success. It names the entity being validated, and a
        // Validator lives on a DataProperty, so on an EntityType, so on the MetadataStore -
        // the longest-lived object there is, and shared between managers. Holding it pins that
        // entity, and everything its navigation properties reach, for the life of the store.
        // Nothing asks for a message after a validation that passed; `this.context` keeps
        // getMessage() answering, without naming a subject.
        this.currentContext = this.context;
        return null;
      } else {
        currentContext.value = value;
        return new ValidationError(this, currentContext, this.getMessage());
      }
    } catch (e) {
      return new ValidationError(this, currentContext, "Exception occured while executing this validator: " + this.name);
    }
  }


  // context.value is not avail unless validate was called first.

  /**
  Returns the message generated by the most recent execution of this Validator.
  @example
      const v0 = Validator.maxLength({ maxLength: 5, displayName: "City" });
      v0.validate("adasdfasdf");
      const errMessage = v0.getMessage();
  @returns {String}
  */
  getMessage() {
    try {
      let context = this.currentContext;
      let message = context.message;
      if (message) {
        if (typeof (message) === "function") {
          return message(context);
        } else {
          return message;
        }
      } else if (context.messageTemplate) {
        return formatTemplate(context.messageTemplate, context);
      } else {
        return "invalid value: " + (this.name || "{unnamed validator}");
      }
    } catch (e) {
      return "Unable to format error message" + e.toString();
    }
  }

  /**
  Returns the serializable form of this validator: its `name` plus the context it was created with,
  such as `{ name: "maxLength", maxLength: 50 }`. Breeze uses it when it exports metadata;
  {@link Validator.fromJSON} reads it back through the factory registered under that name.
  */
  toJSON() {
    return this._baseContext;
  }

  /**
  Creates a validator instance from a JSON object or an array of instances from an array of JSON objects.
  @param json {Object} JSON object that represents the serialized version of a validator.
  */
  public static fromJSON(json: any): any {
    if (Array.isArray(json)) {
      return json.map(function (js) {
        return Validator.fromJSON(js);
      });
    }
    if (json instanceof Validator) {
      return json;
    }
    let validatorName = "Validator." + json.name;
    let fn = config.getRegisteredFunction(validatorName);
    if (!fn) {
      throw new Error("Unable to locate a validator named:" + json.name);
    }
    return fn(json);
  }

  /**
  Register a validator instance so that any deserialized metadata can reference it.
  @param validator {Validator} Validator to register.
  */
  public static register(validator: Validator) {
    config.registerFunction(function () {
      return validator;
    }, "Validator." + validator.name);
  }

  /**
  Register a validator factory so that any deserialized metadata can reference it.
  @param validatorFactory {Function} A function that optionally takes a context property and returns a Validator instance.
  @param name {String} The name of the validator.
  */
  public static registerFactory(validatorFactory: (options?: any) => Validator, name: string) {
    config.registerFunction(validatorFactory, "Validator." + name);
  }

  /**
  Map of standard error message templates keyed by validator name.
  You can add to or modify this object to customize the template used for any validation error message.
  @example
      // v in this function is the value to be validated, in this case a "country" string.
      const valFn = (v: string | null) => v == null || v.startsWith("US");
      const countryValidator = new Validator("countryIsUS", valFn, { displayName: "Country" });
      Validator.messageTemplates.countryIsUS = "'%displayName%' must start with 'US'";
      // This will have a similar effect to this
      const countryValidator2 = new Validator("countryIsUS", valFn, {
          displayName: "Country",
          messageTemplate: "'%displayName%' must start with 'US'"
      });
  @property messageTemplates {Object}
  */
  public static messageTemplates: Record<string, any> = {
    bool: "'%displayName%' must be a 'true' or 'false' value",
    creditCard: "The %displayName% is not a valid credit card number",
    date: "'%displayName%' must be a date",
    duration: "'%displayName%' must be a ISO8601 duration string, such as 'P3H24M60S'",
    emailAddress: "The %displayName% '%value%' is not a valid email address",
    guid: "'%displayName%' must be a GUID",
    integer: "'%displayName%' must be an integer",
    integerRange: "'%displayName%' must be an integer between the values of %minValue% and %maxValue%",
    maxLength: "'%displayName%' must be a string with %maxLength% characters or less",
    number: "'%displayName%' must be a number",
    phone: "The %displayName% '%value%' is not a valid phone number",
    regularExpression: "The %displayName% '%value%' does not match '%expression%'",
    required: "'%displayName%' is required",
    string: "'%displayName%' must be a string",
    stringLength: "'%displayName%' must be a string with between %minLength% and %maxLength% characters",
    url: "The %displayName% '%value%' is not a valid url"
  };

  /**
  Returns a standard 'required value' Validator
  @example
      // Assume em1 is a preexisting EntityManager.
      const custType = em1.metadataStore.getAsEntityType("Customer");
      const regionProperty = custType.getProperty("region");
      // Makes "region" on Customer a required property.
      regionProperty.validators.push(Validator.required());
      // or to allow empty strings
      regionProperty.validators.push(Validator.required({ allowEmptyStrings: true }));
  @param context - An object with `allowEmptyStrings` (boolean) - If this parameter is omitted or false then empty strings do NOT pass validation.
  @returns {Validator} A new Validator
  */
  public static required = function(context?: any) {
    let valFn = function (v: any, ctx: any) {
      if (typeof v === "string") {
        if (ctx && ctx.allowEmptyStrings) return true;
        return v.length > 0;
      } else {
        return v != null;
      }
    };
    return new Validator("required", valFn, context);
  };

  /**
  Returns a standard maximum string length Validator; the maximum length must be specified
  @example
      // Assume em1 is a preexisting EntityManager.
      const custType = em1.metadataStore.getAsEntityType("Customer");
      const regionProperty = custType.getProperty("region");
      // Validates that the value of the region property on Customer will be less than or equal to 5 characters.
      regionProperty.validators.push(Validator.maxLength({ maxLength: 5 }));
  @param context - An object with `maxLength` (number).
  @returns {Validator} A new Validator
  */
  public static maxLength = function(context: any) {
    let valFn = function (v: any, ctx: any) {
      if (v == null) return true;
      if (typeof (v) !== "string") return false;
      return v.length <= ctx.maxLength;
    };
    return new Validator("maxLength", valFn, context);
  };

  /**
  Returns a standard string length Validator; both minimum and maximum lengths must be specified.
  @example
      // Assume em1 is a preexisting EntityManager.
      const custType = em1.metadataStore.getAsEntityType("Customer");
      const regionProperty = custType.getProperty("region");
      // Validates that the value of the region property on Customer will be
      // between 2 and 5 characters
      regionProperty.validators.push(Validator.stringLength({ minLength: 2, maxLength: 5 }));
  @param context - An object with `maxLength` (number); `minLength` (number).
  @returns {Validator} A new Validator
  */
  public static stringLength = function (context: any) {
    let valFn = function (v: any, ctx: any) {
      if (v == null) return true;
      if (typeof (v) !== "string") return false;
      if (ctx.minLength != null && v.length < ctx.minLength) return false;
      if (ctx.maxLength != null && v.length > ctx.maxLength) return false;
      return true;
    };
    return new Validator("stringLength", valFn, context);
  };

  /**
  Returns a standard string dataType Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const custType = em1.metadataStore.getAsEntityType("Customer");
      const regionProperty = custType.getProperty("region");
      // Validates that the value of the region property on Customer is a string.
      regionProperty.validators.push(Validator.string());
  @returns {Validator} A new Validator
  */
  public static string = function () {
    let valFn = function (v: any) {
      if (v == null) return true;
      return (typeof v === "string");
    };
    return new Validator("string", valFn);
  };

  /**
  Returns a Guid data type Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const custType = em1.metadataStore.getAsEntityType("Customer");
      const customerIdProperty = custType.getProperty("customerID");
      // Validates that the value of the customerID property on Customer is a Guid.
      customerIdProperty.validators.push(Validator.guid());
  @returns {Validator} A new Validator
  */
  public static guid = function () {
    let valFn = function (v: any) {
      if (v == null) return true;
      return core.isGuid(v);
    };
    return new Validator("guid", valFn);
  };

  /**
  Returns a ISO 8601 duration string  Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const timeLimitType = em1.metadataStore.getAsEntityType("TimeLimit");
      const maxTimeProperty = timeLimitType.getProperty("maxTime");
      // Validates that the value of the maxTime property on TimeLimit is a duration.
      maxTimeProperty.validators.push(Validator.duration());
  @returns {Validator} A new Validator
  */
  public static duration = function () {
    let valFn = function (v: any) {
      if (v == null) return true;
      return core.isDuration(v);
    };
    return new Validator("duration", valFn);
  };

  /**
  Returns a standard numeric data type Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const orderType = em1.metadataStore.getAsEntityType("Order");
      const freightProperty = orderType.getProperty("freight");
      // Validates that the value of the freight property on Order is a number.
      freightProperty.validators.push(Validator.number());
  @returns {Validator} A new Validator
  */

    // TODO: may need to have seperate logic for single.
  public static number = function(context?: any) {
    let valFn = function (v: any, ctx: any) {
      if (v == null) return true;
      if (typeof v === "string" && ctx && ctx.allowString) {
        v = parseFloat(v);
      }
      return (typeof v === "number" && !isNaN(v));
    };
    return new Validator("number", valFn, context);
  };
  /** Another name for {@link Validator.number}, registered as `double` so that metadata naming it imports. The validator it returns is named `number`. */
  public static double = Validator.number;
  /** Another name for {@link Validator.number}, registered as `single` so that metadata naming it imports. The validator it returns is named `number`. */
  public static single = Validator.number;

  /**
  Returns a standard large integer data type - 64 bit - Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const orderType = em1.metadataStore.getAsEntityType("Order");
      const freightProperty = orderType.getProperty("freight");
      // Validates that the value of the freight property on Order is within the range of a 64 bit integer.
      freightProperty.validators.push(Validator.int64());
  @returns {Validator} A new Validator
  */
  public static integer = function(context?: any) {
    let valFn = function (v: any, ctx: any) {
      if (v == null) return true;
      if (typeof v === "string" && ctx && ctx.allowString) {
        v = parseInt(v, 10);
      }
      return (typeof v === "number") && (!isNaN(v)) && Math.floor(v) === v;
    };
    return new Validator("integer", valFn, context);
  };
  /** Another name for {@link Validator.integer}, and the data-type validator for {@link DataType.Int64}: it checks that the value is a whole number, with no range check. The validator it returns is named `integer`. */
  public static int64 = Validator.integer;

  /**
  Returns a standard 32 bit integer data type Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const orderType = em1.metadataStore.getAsEntityType("Order");
      const freightProperty = orderType.getProperty("freight");
      freightProperty.validators.push(Validator.int32());
  @returns {Validator} A new Validator
  */
  public static int32 = function(context?: any) {
    return intRangeValidatorCtor("int32", INT32_MIN, INT32_MAX, context)();
  };

  /**
  Returns a standard 16 bit integer data type Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const orderType = em1.metadataStore.getAsEntityType("Order");
      const freightProperty = orderType.getProperty("freight");
      // Validates that the value of the freight property on Order is within the range of a 16 bit integer.
      freightProperty.validators.push(Validator.int16());
  @returns {Validator} A new Validator
  */
  public static int16 = function(context?: any) {
    return intRangeValidatorCtor("int16", INT16_MIN, INT16_MAX, context)();
  };

  /**
  Returns a standard byte data type Validator. (This is a integer between 0 and 255 inclusive for js purposes).
  @example
      // Assume em1 is a preexisting EntityManager.
      const orderType = em1.metadataStore.getAsEntityType("Order");
      const freightProperty = orderType.getProperty("freight");
      // Validates that the value of the freight property on Order is a byte: an integer from 0 to 255.
      // Probably not a very good validation to place on the freight property.
      freightProperty.validators.push(Validator.byte());
  @returns {Validator} A new Validator
  */
  public static byte = function(context?: any) {
    return intRangeValidatorCtor("byte", BYTE_MIN, BYTE_MAX, context)();
  };

  /**
  Returns a standard boolean data type Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const productType = em1.metadataStore.getAsEntityType("Product");
      const discontinuedProperty = productType.getProperty("isDiscontinued");
      // Validates that the value of the isDiscontinued property on Product is a boolean
      discontinuedProperty.validators.push(Validator.bool());
  @returns {Validator} A new Validator
  */
  public static bool = function() {
    let valFn = function (v: any) {
      if (v == null) return true;
      return (v === true) || (v === false);
    };
    return new Validator("bool", valFn);
  };

  /** Returns a Validator named `none` that accepts every value. It is the data-type validator for {@link DataType.Binary} and {@link DataType.Undefined}. */
  public static none = function() {
    let valFn = function (v: any) {
      return true;
    };
    return new Validator("none", valFn);
  };

  /**
  Returns a standard date data type Validator.
  @example
      // Assume em1 is a preexisting EntityManager.
      const orderType = em1.metadataStore.getAsEntityType("Order");
      const orderDateProperty = orderType.getProperty("orderDate");
      // Validates that the value of the orderDate property on Order is a date
      orderDateProperty.validators.push(Validator.date());
  @returns {Validator} A new Validator
  */
  public static date = function() {
    let valFn = function (v: any) {
      if (v == null) return true;
      if (typeof v === "string") {
        try {
          return !isNaN(Date.parse(v));
          // old code
          // return __isDate(new Date(v));
        } catch (e) {
          return false;
        }
      } else {
        return core.isDate(v);
      }
    };
    return new Validator("date", valFn);
  };

  /**
  Returns a credit card number validator
  Performs a luhn algorithm checksum test for plausability
  catches simple mistakes; only service knows for sure
  @example
      // Assume em is a preexisting EntityManager.
      const personType = em.metadataStore.getAsEntityType("Person");
      const creditCardProperty = personType.getProperty("creditCard");
      // Validates that the value of the Person.creditCard property is credit card.
      creditCardProperty.validators.push(Validator.creditCard());
  @param [context] {Object} optional parameters to pass through to validation constructor
  @returns {Validator} A new Validator
  */
  public static creditCard = function(context?: any) {
    function valFn(v: any) {
      if (v == null || v === '') return true;
      if (typeof (v) !== 'string') return false;
      v = v.replace(/(\-|\s)/g, ""); // remove dashes and spaces
      if (!v || /\D/.test(v)) return false; // all digits, not empty
      return luhn(v);
    }
    return new Validator('creditCard', valFn, context);
  };


  /**
  Returns a regular expression validator; the expression must be specified
  @example
      // Add validator to a property. Assume em is a preexisting EntityManager.
      const customerType = em.metadataStore.getAsEntityType("Customer");
      const regionProperty = customerType.getProperty("region");
      // Validates that the value of Customer.region is 2 char uppercase alpha.
      regionProperty.validators.push(Validator.regularExpression({ expression: '^[A-Z]{2}$' }));
  @param context - An object with `expression` (string) - String form of the regular expression to apply.
  @returns {Validator} A new Validator
  */
  public static regularExpression = function(context?: any) {
    function valFn(v: any, ctx: any) {
      // do not invalidate if empty; use a separate required test
      if (v == null || v === '') return true;
      if (typeof (v) !== 'string') return false;
      try {
        let re = new RegExp(ctx.expression);
        return re.test(v);
      } catch (e) {
        throw new Error('Missing or invalid expression parameter to regExp validator');
      }
    }
    return new Validator('regularExpression', valFn, context);
  };

  /**
  Returns the email address validator
  @example
      // Assume em is a preexisting EntityManager.
      const userType = em.metadataStore.getAsEntityType("User");
      const emailProperty = userType.getProperty("email");
      // Validates that the value of the User.email property is an email address.
      emailProperty.validators.push(Validator.emailAddress());
  @param [context] {Object} optional parameters to pass through to validation constructor
  @returns {Validator} A new Validator
  */
  public static emailAddress = function(context?: any) {
    // See https://github.com/srkirkland/DataAnnotationsExtensions/blob/master/DataAnnotationsExtensions/EmailAttribute.cs
    let reEmailAddress = /^((([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+(\.([a-z]|\d|[!#\$%&'\*\+\-\/=\?\^_`{\|}~]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])+)*)|((\x22)((((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(([\x01-\x08\x0b\x0c\x0e-\x1f\x7f]|\x21|[\x23-\x5b]|[\x5d-\x7e]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(\\([\x01-\x09\x0b\x0c\x0d-\x7f]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))))*(((\x20|\x09)*(\x0d\x0a))?(\x20|\x09)+)?(\x22)))@((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.?$/i;
    return makeRegExpValidator('emailAddress', reEmailAddress, null, context);
  };

  /**
  Returns the phone validator
  Provides basic assertions on the format and will help to eliminate most nonsense input
  Matches:
  International dialing prefix: one of nothing, `+`, `0` or `0000` (with or without a trailing break character, if not '+': [-/. ])
  ```ts
  ((\+)|(0(\d+)?[-/.\s]))
  ```
  Country code: nothing, or `1` to `999` (with or without a trailing break character: [-/. ])
  ```ts
  [1-9]\d{,2}[-/.\s]?
  ```
  Area code: `(0)` to `(000000)`, or `0` to `000000` (with or without a trailing break character: [-/. ])
  ```ts
  ((\(\d{1,6}\)|\d{1,6})[-/.\s]?)?
  ```
  Local: one or more digits (with or without a trailing break character: [-/. ])
  ```ts
  (\d+[-/.\s]?)+\d+
  ```
  @example
      // Assume em is a preexisting EntityManager.
      const customerType = em.metadataStore.getAsEntityType("Customer");
      const phoneProperty = customerType.getProperty("phone");
      // Validates that the value of the Customer.phone property is phone.
      phoneProperty.validators.push(Validator.phone());
  @param [context] {Object} optional parameters to pass through to validation constructor
  @returns {Validator} A new Validator
  */
  public static phone = function (context?: any) {
    // See https://github.com/srkirkland/DataAnnotationsExtensions/blob/master/DataAnnotationsExtensions/Expressions.cs
    let rePhone = /^((\+|(0(\d+)?[-/.\s]?))[1-9]\d{0,2}[-/.\s]?)?((\(\d{1,6}\)|\d{1,6})[-/.\s]?)?(\d+[-/.\s]?)+\d+$/;
    return makeRegExpValidator('phone', rePhone, null, context);
  };

  /**
  Returns the URL (protocol required) validator
  @example
      // Assume em is a preexisting EntityManager.
      const supplierType = em.metadataStore.getAsEntityType("Supplier");
      const homePageProperty = supplierType.getProperty("homePage");
      // Validates that the value of the Supplier.homePage property is a URL.
      homePageProperty.validators.push(Validator.url());
  @param [context] {Object} optional parameters to pass through to validation constructor
  @returns {Validator} A new Validator
  */
  public static url = function (context?: any) {
    //See https://github.com/srkirkland/DataAnnotationsExtensions/blob/master/DataAnnotationsExtensions/UrlAttribute.cs
    let reUrlProtocolRequired = /^(https?|ftp):\/\/(((([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-fA-F]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?(((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|([a-zA-Z][\-a-zA-Z0-9]*)|((([a-zA-Z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-zA-Z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-zA-Z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-zA-Z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-zA-Z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-zA-Z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.?)(:\d*)?)(\/((([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-fA-F]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-fA-F]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)?(\?((([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-fA-F]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-zA-Z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-fA-F]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/;
    return makeRegExpValidator('url', reUrlProtocolRequired, null, context);
  };

  /**
  Creates a regular expression validator with a fixed expression.
  Many of the stock validators are built with this factory method.
  Their expressions are often derived from
  https://github.com/srkirkland/DataAnnotationsExtensions/blob/master/DataAnnotationsExtensions
  You can try many of them at http://dataannotationsextensions.org/
  @example
      // Make a zipcode validator
      const zipValidator = Validator.makeRegExpValidator(
          "zipVal",
          /^\d{5}([\-]\d{4})?$/,
          "The %displayName% '%value%' is not a valid U.S. zipcode");
      // Register it.
      Validator.register(zipValidator);
      // Add it to a data property. Assume em is a preexisting EntityManager.
      const custType = em.metadataStore.getAsEntityType("Customer");
      const zipProperty = custType.getProperty("postalCode");
      zipProperty.validators.push(zipValidator);
  @param validatorName {String} name of this validator
  @param expression {String | RegExp} regular expression to apply
  @param [defaultMessage] {String} default message for failed validations
  @param [context] {Object} optional parameters to pass through to validation constructor
  @returns {Validator} A new Validator
  */
  public static makeRegExpValidator = makeRegExpValidator;

}
Validator.prototype._$typeName = "Validator";

// register all validators
core.objectForEach(Validator, function (key: string, value: any) {
  if (typeof (value) !== "function") {
    return;
  }
  if (key === "fromJSON" || key === "register" ||
      key === "registerFactory" || key === "makeRegExpValidator") {
    return;
  }

  config.registerFunction(value, "Validator." + key);
});

function formatTemplate(template: string, vars: Object, ownPropertiesOnly: boolean = false) {
  if (!vars) return template;
  return template.replace(/%([^%]+)%/g, function (_, key) {
    let valOrFn: any;
    if (ownPropertiesOnly) {
      valOrFn = vars.hasOwnProperty(key) ? (vars as Record<string, any>)[key] : '';
    } else {
      valOrFn = (vars as Record<string, any>)[key];
    }
    if (valOrFn != null) {
      if (core.isFunction(valOrFn)) {
        return valOrFn(vars);
      } else {
        return valOrFn;
      }
    } else {
      return "";
    }
  });
}

function intRangeValidatorCtor(validatorName: string, minValue: number, maxValue: number, context: any) {
  context = context || {};
  if (minValue !== undefined) { context.min = minValue; }
  if (maxValue !== undefined) { context.max = maxValue; }
  let templateExists = context.messageTemplate || Validator.messageTemplates[validatorName];
  if (!templateExists) {
    Validator.messageTemplates[validatorName] = core.formatString("'%displayName%' must be an integer between the values of %1 and %2",
        minValue, maxValue);
  }
  return function () {
    let valFn = function (v: any, ctx: any) {
      if (v == null) return true;
      if (typeof v === "string" && ctx && ctx.allowString) {
        v = parseInt(v, 0);
      }
      if ((typeof v === "number") && (!isNaN(v)) && Math.floor(v) === v) {
        if (minValue != null && v < minValue) {
          return false;
        }
        if (maxValue != null && v > maxValue) {
          return false;
        }
        return true;
      } else {
        return false;
      }
    };
    return new Validator(validatorName, valFn, context);
  };
}

export function makeRegExpValidator(validatorName: string, expression: RegExp, defaultMessage?: string | null, context?: any) {
  if (defaultMessage) {
    Validator.messageTemplates[validatorName] = defaultMessage;
  }
  let re = (typeof (expression) === 'string') ? new RegExp(expression) : expression;
  let valFn = function (v: any) {
    // do not invalidate if empty; use a separate required test
    if (v == null || v === '') return true;
    if (typeof (v) !== 'string') return false;
    return re.test(v);
  };
  return new Validator(validatorName, valFn, context);
}

// http://rosettacode.org/wiki/Luhn_test_of_credit_card_numbers#JavaScript

// function luhn(a: string, b: number, c: number, d: number, e: number) {
//   for (d = +a[b = a.length - 1], e = 0; b--; ) {
//     c = +a[b], d += ++e % 2 ? 2 * c % 10 + (c > 4) : c;
//   }
//   return !(d % 10);
// };

let  luhn = (function() {
  let luhnArr = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9];
  return function(str: string) 	{
    let counter = 0;
    let incNum: number;
    let odd = false;
    let temp = String(str).replace(/[^\d]/g, "");
    if ( temp.length === 0) return false;
    for (let i = temp.length - 1; i >= 0; --i)  {
      incNum = parseInt(temp.charAt(i), 10);
      counter += (odd = !odd) ? incNum : luhnArr[incNum];
    }
    return (counter % 10 === 0);
  };
})();

/**
Describes one failed validation: which validator failed, on which property, and the message to
show. An entity's current errors are in {@link EntityAspect.getValidationErrors}. The errors a
server reports for a failed save are added there too, with {@link ValidationError.isServerError} set.
*/
export class ValidationError {
  /** The {@link Validator} that produced this error. `undefined` for an error from the server or one created without a validator. __Read Only__ */
  validator?: Validator;
  /** The key that identifies this error among an entity's validation errors: the validator's name (or the error name), then `:` and the property name if there is one. Adding an error with the same key replaces the old one. __Read Only__ */
  key: string;
  /** The context the error was created with - for a validator, its context when it ran, which for a property error includes `entity`, `property`, `propertyName` and `value`. __Read Only__ */
  context: any;
  /** The error message. __Read Only__ */
  errorMessage: string;
  /** The {@link DataProperty} or {@link NavigationProperty} this error is about, or `undefined` for an entity-level error. __Read Only__ */
  property: any; // IProperty
  /** The name of the property this error is about - a property path, such as `address.city`, for a property of a complex object - or `undefined` for an entity-level error. __Read Only__ */
  propertyName?: string;
  /** Whether this error came from the server in a failed save. Server errors do not block a save, and are cleared when the property is changed or the entity is saved again. __Read Only__ */
  isServerError: boolean;

  /**
  Creates a validation error. Applications usually add one with
  {@link EntityAspect.addValidationError} after creating it here.
  @param validator - The Validator that found the error, or `null` for an error found some other way.
  @param context - The context to record with the error: for a property, its `entity`, `property`,
    `propertyName` and `value`.
  @param errorMessage - The message to show.
  @param key - Identifies the error among the entity's errors. If not given, it is built from the
    validator's name - or, without a validator, the error message - and the property name; see
    {@link ValidationError.getKey}.
  */
  constructor(validator: Validator | null, context: ValidationContext, errorMessage: string, key?: string) {
    // Error is with isInstanceOf(Validator)
    assertParam(validator, "validator").isOptional().isInstanceOf(Validator).check();
    assertParam(errorMessage, "errorMessage").isNonEmptyString().check();
    assertParam(key, "key").isOptional().isNonEmptyString().check();
    this.validator = validator || undefined;
    context = context || {};
    this.context = context;
    this.errorMessage = errorMessage;

    this.property = context.property;
    this.propertyName = context.propertyName || (context.property && context.property.name);

    if (key) {
      this.key = key;
    } else {
      this.key = ValidationError.getKey(validator || errorMessage, this.propertyName);
    }
    this.isServerError = false;
  }

  /**
  Composes a ValidationError 'key' given a validator or an errorName and an optional propertyName
  @param validatorOrErrorName - A Validator, or an "error name" if no validator is available.
  @param [propertyName] A property name
  @returns {String} A ValidationError 'key'
  */
  public static getKey(validatorOrErrorName: Validator | string, propertyName?: string) {
    let name = (typeof validatorOrErrorName === 'string') ? validatorOrErrorName : validatorOrErrorName.name;
    return name + (propertyName ? ":" + propertyName : "");
  }

}


