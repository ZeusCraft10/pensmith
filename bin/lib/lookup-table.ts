// bin/lib/lookup-table.ts — string-keyed lookup tables without a prototype
// (review round 3).
//
// A plain object literal inherits Object.prototype, so `TABLE[key] ?? fallback`
// with a key read from outside — a registrar's title (`&constructor;`), a TeX
// command (`\toString`), a Zotero item type, a model's JSON answer, a config
// value — returns an inherited FUNCTION for `constructor`, `toString`,
// `valueOf`, `__proto__` … instead of the fallback, and that function's source
// text ends up in a title, a type or a style name. Every table looked up by an
// outside key is built here: frozen, with a null prototype, so a missing key is
// undefined and nothing else. Pure.

/** A frozen copy of `entries` with no prototype: only its own keys resolve. */
export function lookupTable<T>(entries: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, T>, entries));
}
