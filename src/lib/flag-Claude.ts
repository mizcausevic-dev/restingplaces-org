// Pure ISO 3166-1 alpha-2 -> flag emoji conversion (regional indicator
// symbols). No lookup table: this is a deterministic Unicode transform, so
// the flag is only ever as correct as the iso2 code itself, which comes
// exclusively from real Wikidata P297 values (see scripts/geo-metadata-Claude.mjs).
// A country with no iso2 (historical/colonial entities) renders no flag,
// never a guessed one.
export function flagEmoji(iso2: string | null): string | null {
  if (!iso2 || iso2.length !== 2) return null;
  const codePoints = [...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
