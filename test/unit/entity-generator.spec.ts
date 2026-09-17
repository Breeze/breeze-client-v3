import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// scripts/generate-entity-classes.js - the tool that writes test/model/ and, published as the
// `breeze-gen-entities` bin, an application's model directory too.
//
// What is worth pinning here is the ownership rule, because it is the part that decides whether
// somebody's hand-written code survives: THE METADATA says what the generator owns, not the
// `// @generated` marker. That is what lets a class with no markers anywhere be adopted a
// property at a time instead of having its whole body appended a second time - and it is why the
// manual markers exist, since deleting a marker no longer means "hands off".
//
// These run the real script against a real metadata document in a temp directory. It needs
// dist/breeze.js, so `npm run build` has to have happened; the suite skips rather than fails if
// it has not, which is the same rule the script itself applies.

const repoRoot = join(__dirname, '..', '..');
const script = join(repoRoot, 'scripts', 'generate-entity-classes.js');
const metadata = join(repoRoot, 'test', 'support', 'NorthwindIBMetadata_ETNOPAYLOAD.json');
const built = existsSync(join(repoRoot, 'dist', 'breeze.js'));

let dir: string;

/** Run the generator against `dir`, returning its stdout. */
function generate(...args: string[]) {
  return execFileSync(process.execPath,
    [script, '--metadata', metadata, '--out', 'model', '--no-index', ...args],
    { cwd: dir, encoding: 'utf8' });
}

const read = (name: string) => readFileSync(join(dir, 'model', name), 'utf8');
const write = (name: string, text: string) => writeFileSync(join(dir, 'model', name), text, 'utf8');

/** A class exactly as somebody would have written it before the generator existed. */
const HAND_WRITTEN = `import { Entity, EntityAspect, EntityType } from 'breeze-client';

/** Our customer. */
export class Customer implements Entity {
  entityAspect: EntityAspect;
  entityType: EntityType;
  getProperty: (prop: string) => any;
  setProperty: (prop: any, value: any) => any;

  customerID: string;
  companyName: string;
  city: string;

  isBeingEdited = false;

  constructor() {
    this.isBeingEdited = false;
  }

  get label() {
    return this.companyName;
  }

  touch(): void {
    this.isBeingEdited = true;
  }
}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'breeze-gen-'));
  mkdirSync(join(dir, 'model'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!built)("entity generator", () => {

  describe("adopting a hand-written class", () => {

    test("a plain run will not touch a file it did not write", () => {
      write('customer.ts', HAND_WRITTEN);
      const out = generate('--types', 'Customer');

      expect(out).toContain('skip customer.ts');
      expect(out).toContain('--adopt');
      expect(read('customer.ts')).toBe(HAND_WRITTEN);   // byte for byte
    });

    test("--adopt claims the mapped properties and leaves everything else", () => {
      write('customer.ts', HAND_WRITTEN);
      generate('--types', 'Customer', '--adopt');
      const after = read('customer.ts');

      // The three it declared are now the generator's - marked, and given the `declare` they
      // lacked. Without `declare` an ES2022 class field shadows the accessors Breeze installs.
      for (const name of ['customerID', 'companyName', 'city']) {
        expect(after).toContain(`declare ${name}: string;  // @generated`);
      }
      // ...and each appears exactly once: adoption is not duplication.
      expect(after.match(/declare customerID:/g)).toHaveLength(1);

      // The rest of the metadata arrived too.
      expect(after).toContain('declare orders: RelationArray<Order>;  // @generated');

      // None of this is the generator's business.
      expect(after).toContain('constructor() {');
      expect(after).toContain('this.isBeingEdited = false;');
      expect(after).toContain('get label() {');
      expect(after).toContain('touch(): void {');
      expect(after).toContain('isBeingEdited = false;');
      expect(after).toContain('/** Our customer. */');
    });

    test("--adopt rewrites the class declaration and drops what the base supplies", () => {
      write('customer.ts', HAND_WRITTEN);
      generate('--types', 'Customer', '--adopt');
      const after = read('customer.ts');

      expect(after).toContain('export class Customer extends EntityBase {');
      expect(after).not.toContain('implements Entity');
      // EntityBase declares these; redeclaring them here would shadow it.
      for (const name of ['entityAspect', 'entityType', 'getProperty', 'setProperty']) {
        expect(after).not.toMatch(new RegExp(`^\\s+${name}:`, 'm'));
      }
    });

    test("--adopt --dry-run reports the whole edit and writes nothing", () => {
      write('customer.ts', HAND_WRITTEN);
      const out = generate('--types', 'Customer', '--adopt', '--dry-run');

      expect(out).toContain('adopt customerID: string');
      expect(out).toContain('would change');
      expect(read('customer.ts')).toBe(HAND_WRITTEN);
    });

  });

  describe("ownership comes from the metadata, not the marker", () => {

    test("an unmarked mapped property is claimed; an unmarked one the metadata lacks is not", () => {
      generate('--types', 'Customer');
      // Strip the marker off a mapped property and add a member of our own with no marker.
      write('customer.ts', read('customer.ts')
        .replace('declare city: string;  // @generated', 'declare city: string;')
        .replace('}\n', '  declare somethingOfMine: string;\n}\n'));

      generate('--types', 'Customer');
      const after = read('customer.ts');

      expect(after).toContain('declare city: string;  // @generated');   // reclaimed
      expect(after).toContain('declare somethingOfMine: string;');       // untouched
      expect(after.match(/somethingOfMine/g)).toHaveLength(1);
    });

    test("a marked property the metadata has dropped is removed - the one job left to the marker", () => {
      generate('--types', 'Customer');
      write('customer.ts', read('customer.ts')
        .replace('}\n', '  declare goneFromTheServer: string;  // @generated\n}\n'));

      const out = generate('--types', 'Customer');
      expect(out).toContain('remove goneFromTheServer');
      expect(read('customer.ts')).not.toContain('goneFromTheServer');
    });

    test("regenerating twice in a row changes nothing", () => {
      generate('--types', 'Customer');
      const first = read('customer.ts');
      const out = generate('--types', 'Customer');

      expect(out).toContain('0 file(s) written');
      expect(read('customer.ts')).toBe(first);
    });

  });

  describe("the manual markers", () => {

    test("// @manual pins one declaration against the metadata", () => {
      generate('--types', 'Customer');
      write('customer.ts', read('customer.ts')
        .replace('declare city: string;  // @generated', 'declare city: CityName;  // @manual'));
      const pinned = read('customer.ts');

      const out = generate('--types', 'Customer');
      expect(out).not.toContain('city: string');
      expect(read('customer.ts')).toBe(pinned);
    });

    test("// @manual-start ... // @manual-end pins a block, and nothing is inserted inside it", () => {
      generate('--types', 'Customer');
      write('customer.ts', read('customer.ts')
        .replace('  declare phone: string;  // @generated',
          '  // @manual-start\n  declare phone: PhoneNumber;   // and this comment\n  // @manual-end'));
      const pinned = read('customer.ts');

      generate('--types', 'Customer');
      const after = read('customer.ts');
      expect(after).toBe(pinned);
      expect(after).toContain('declare phone: PhoneNumber;   // and this comment');
      expect(after.match(/declare phone/g)).toHaveLength(1);   // not re-added below the region
    });

    test("// @manual-file leaves the file byte for byte", () => {
      generate('--types', 'Customer');
      const mine = '// @manual-file\nexport class Customer { mine = 1; }\n';
      write('customer.ts', mine);

      const out = generate('--types', 'Customer');
      expect(out).toContain('keep customer.ts');
      expect(read('customer.ts')).toBe(mine);
    });

    test("a file that merely mentions a marker is not opted out", () => {
      // The generated header used to name the markers, which opted every generated file out of
      // the generator. They only count on a line of their own.
      generate('--types', 'Customer');
      write('customer.ts', read('customer.ts')
        .replace('/**', '/**\n * Use `// @manual-file` to keep a file, `// @manual-start` for a block.'));

      const out = generate('--types', 'Customer');
      expect(out).not.toContain('keep customer.ts');
    });

  });

  describe("formatting", () => {

    test("a reformatted marked line is left alone rather than rewritten back", () => {
      // Prettier collapses the two spaces before the marker to one. Comparing rendered strings
      // byte for byte would make the generator undo that on every run, forever.
      generate('--types', 'Customer');
      write('customer.ts', read('customer.ts').replace(/;  \/\/ @generated/g, '; // @generated'));
      const formatted = read('customer.ts');

      const out = generate('--types', 'Customer');
      expect(out).toContain('0 file(s) written');
      expect(read('customer.ts')).toBe(formatted);
    });

    test("an existing file keeps its line endings", () => {
      generate('--types', 'Customer');
      write('customer.ts', read('customer.ts').replace(/\r?\n/g, '\r\n'));

      generate('--types', 'Customer');
      const after = read('customer.ts');
      expect(after).toContain('\r\n');
      expect(after).not.toMatch(/[^\r]\n/);        // no line reverted to bare LF
      // The colon matters: Customer also has a customerID_OLD.
      expect(after.match(/declare customerID:/g)).toHaveLength(1);   // and nothing duplicated
    });

  });

  describe("--base", () => {

    test("changing it re-points the extends clause, not just the import", () => {
      generate('--types', 'Customer');
      expect(read('customer.ts')).toContain('extends EntityBase');

      const out = generate('--types', 'Customer', '--base', 'AppEntityBase');
      expect(out).toContain('extends AppEntityBase - was EntityBase');

      const after = read('customer.ts');
      expect(after).toContain('export class Customer extends AppEntityBase {');
      expect(after).toContain("import { AppEntityBase } from './app-entity-base';");
      expect(after).not.toContain('extends EntityBase');
    });

  });

});
