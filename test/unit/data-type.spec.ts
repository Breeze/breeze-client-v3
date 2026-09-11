import { DataType } from '../../src/breeze';

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
