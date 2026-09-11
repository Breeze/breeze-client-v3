import { DataProperty, DataType } from '../../src/breeze';

// No server needed.

describe("DataType coercion", () => {

  test("DateOnly parses a string assigned to it", () => {
    // coerceToDateOnly parsed an undefined variable instead of its argument, so a string
    // assigned to a DateOnly property stayed a string.
    const d = DataType.DateOnly.parse!("2024-03-15", "string");
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  test("DateOnly treats a blank string as null", () => {
    expect(DataType.DateOnly.parse!("  ", "string")).toBeNull();
  });

});

describe("DataType names from the server", () => {

  test("TimeSpan, the name EF Core writes for a .NET TimeSpan, is DataType.Time", () => {
    expect(DataType.fromName("TimeSpan")).toBe(DataType.Time);
    expect(DataType.fromName("Time")).toBe(DataType.Time);
  });

  test("TimeOnly is a data type of its own", () => {
    expect(DataType.fromName("TimeOnly")).toBe(DataType.TimeOnly);
    expect(DataType.TimeOnly.defaultValue).toBe("00:00:00");
  });

  test("other CLR and NHibernate type names map to the nearest client type", () => {
    expect(DataType.fromName("Char")).toBe(DataType.String);
    expect(DataType.fromName("AnsiString")).toBe(DataType.String);
    expect(DataType.fromName("SByte")).toBe(DataType.Int16);
    expect(DataType.fromName("UInt16")).toBe(DataType.Int32);
    expect(DataType.fromName("UInt32")).toBe(DataType.Int64);
    expect(DataType.fromName("UInt64")).toBe(DataType.Int64);
  });

  test("an unknown name, or a DataType member that is not a type, gives undefined", () => {
    expect(DataType.fromName("HalfPrecision")).toBeUndefined();
    expect(DataType.fromName("parseRawValue")).toBeUndefined();
  });

  test("DataProperty.fromJSON and the constructor agree on server names", () => {
    expect(DataProperty.fromJSON({ name: "d", dataType: "TimeSpan" }).dataType).toBe(DataType.Time);
    expect(new DataProperty({ name: "d", dataType: "TimeSpan" }).dataType).toBe(DataType.Time);
    expect(DataProperty.fromJSON({ name: "t", dataType: "TimeOnly" }).dataType).toBe(DataType.TimeOnly);
  });

  test("an unknown name imports as Undefined, keeps the name in rawTypeName, and warns once", () => {
    // It used to become DataType.String without a word.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
    try {
      const dp = DataProperty.fromJSON({ name: "p", dataType: "HalfPrecision" });
      DataProperty.fromJSON({ name: "q", dataType: "HalfPrecision" });
      expect(dp.dataType).toBe(DataType.Undefined);
      expect(dp.rawTypeName).toBe("HalfPrecision");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("HalfPrecision");
    } finally {
      warn.mockRestore();
    }
  });

  test("the constructor still rejects an unknown name", () => {
    expect(() => new DataProperty({ name: "p", dataType: "HalfPrecision" })).toThrow(/HalfPrecision/);
  });

});

describe("DataType.DateOnly", () => {

  test("normalizes to local midnight, so values on the same day compare equal", () => {
    const n = DataType.DateOnly.normalize!;
    expect(n(new Date(2024, 2, 15, 9, 30))).toBe(n(new Date(2024, 2, 15, 18, 0)));
    expect(n(new Date(2024, 2, 15, 9, 30))).toBe(new Date(2024, 2, 15).getTime());
    expect(n(null)).toBeNull();
  });

  test("normalized values order correctly across the year 2000", () => {
    // With getYear(), 1 January 2000 normalized to a day in the year 100, before 1999.
    const n = DataType.DateOnly.normalize!;
    expect(n(new Date(2000, 0, 1))).toBeGreaterThan(n(new Date(1999, 11, 31)));
  });

  test("has the date validator", () => {
    const v = DataType.DateOnly.validatorCtor!();
    expect(v.name).toBe("date");
    expect(v.validate(new Date(2024, 2, 15))).toBeNull();
    expect(v.validate("not a date")).not.toBeNull();
  });

});

describe("DataType.TimeOnly", () => {

  test("its validator accepts the strings a .NET TimeOnly is sent as, and nothing else", () => {
    const v = DataType.TimeOnly.validatorCtor!();
    expect(v.validate("14:30")).toBeNull();
    expect(v.validate("14:30:00")).toBeNull();
    expect(v.validate("01:23:45.678")).toBeNull();
    expect(v.validate(null)).toBeNull();
    expect(v.validate("24:00")).not.toBeNull();
    expect(v.validate("PT4H")).not.toBeNull();
  });

});
