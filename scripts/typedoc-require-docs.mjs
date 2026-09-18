// @ts-check
/**
 * Fails the API reference build when anything in it has no description.
 *
 * Every entry in the reference - each export, and each member, constructor and field under
 * it - is read by someone who reached it from a signature, a search, or a link. An entry
 * with only a name and a type tells them nothing the .d.ts did not, so each one must say
 * what it is for.
 *
 * TypeDoc's own `validation.notDocumented` misses some: an interface whose only member is
 * an index signature (`ITempKeyMap`), the members of an inline object type, and the
 * properties of an object literal such as the 2.x `breeze` object. This walks every
 * reflection instead.
 *
 * What counts as documented: a summary, or a `@returns`, `@deprecated`, `@remarks` or
 * `@example` block, on the item itself or on any of its signatures (for a function or
 * method, any overload; for an accessor, its getter or setter; for an index-signature-only
 * interface, the index signature).
 *
 * Not checked:
 * - Inherited members. They are documented where they are declared.
 * - Anything `@hidden` or `@internal`: it is not in the reference.
 * - Parameters and type parameters, and anything inside a parameter's type. They are covered
 *   by the item's own description and its `@param` tags, and requiring a tag for each would
 *   mostly produce `@param x - the x`.
 * - A constructor type written inline, such as `new () => Entity` in a union.
 *
 * Checked, although nested: the fields of a return type or property type written as an
 * object literal. The reference gives each of those a heading of its own.
 *
 * Runs in `npm run docs:api`, so `docs:dev` and `docs:build` fail on a new undocumented
 * item rather than publishing an empty entry.
 */
import { Converter, ReflectionKind } from 'typedoc';

const CHECKED =
  ReflectionKind.Namespace | ReflectionKind.Enum | ReflectionKind.EnumMember |
  ReflectionKind.Variable | ReflectionKind.Function | ReflectionKind.Class |
  ReflectionKind.Interface | ReflectionKind.Constructor | ReflectionKind.Property |
  ReflectionKind.Method | ReflectionKind.Accessor | ReflectionKind.TypeAlias;

const DESCRIBING_TAGS = new Set(['@returns', '@deprecated', '@remarks', '@example']);

/** @param {import('typedoc').Comment | undefined} comment */
function describes(comment) {
  if (!comment) return false;
  return comment.summary.some(part => part.text.trim() !== '')
    || comment.blockTags.some(tag => DESCRIBING_TAGS.has(tag.tag));
}

/** @param {any} r - a DeclarationReflection */
function isDocumented(r) {
  return describes(r.comment)
    || (r.signatures ?? []).some(s => describes(s.comment))
    || describes(r.getSignature?.comment) || describes(r.setSignature?.comment)
    || (r.indexSignatures ?? []).some(s => describes(s.comment));
}

/**
 * Whether the item, or anything it sits under, is inherited. The fields of an inherited
 * method's return type are copies too, and are reported where the method is declared.
 * @param {any} r
 */
function isInherited(r) {
  for (let p = r; p; p = p.parent) if (p.inheritedFrom) return true;
  return false;
}

/**
 * Whether the item is part of a parameter's type, such as a field of an options object or the
 * `new () => T` of a constructor argument. Those render inline in the signature, where the
 * parameter's own description covers them; they are not entries of their own.
 * @param {any} r
 */
function isInParameter(r) {
  for (let p = r.parent; p; p = p.parent) if (p.kindOf?.(ReflectionKind.Parameter)) return true;
  return false;
}

/**
 * A constructor is an entry only on a class, or on an interface that declares `new (...)`.
 * The constructor *type* inside a union such as `EntityType | string | (new () => Entity)`
 * renders inline.
 * @param {any} r
 */
function isInlineConstructorType(r) {
  return r.kindOf(ReflectionKind.Constructor) && !r.parent?.kindOf(ReflectionKind.Class | ReflectionKind.Interface);
}

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const missing = [];
    for (const r of Object.values(context.project.reflections)) {
      if (!r.kindOf(CHECKED)) continue;
      const decl = /** @type {any} */ (r);
      if (r.flags.isExternal || isInherited(decl) || isInParameter(decl) || isInlineConstructorType(decl)) continue;
      if (!isDocumented(decl)) {
        const where = decl.sources?.[0];
        missing.push(`  ${r.getFriendlyFullName()} (${ReflectionKind.singularString(r.kind)})` +
          (where ? `  ${where.fileName}:${where.line}` : ''));
      }
    }
    if (missing.length) {
      app.logger.error(
        `typedoc-require-docs: ${missing.length} item(s) in the API reference have no description. ` +
        'Add a doc comment to each:\n' + missing.sort().join('\n'));
    }
  });
}
