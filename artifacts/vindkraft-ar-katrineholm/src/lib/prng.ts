/**
 * Deterministisk, sömlös "slumpmässighet" baserad på en textnyckel (t.ex.
 * verkets namn). Samma nyckel ger alltid samma tal i intervallet [0, 1) —
 * används för att ge varje vindkraftverk en egen men stabil rotorvinkel,
 * rotorhastighet och blinkfas utan att behöva spara något i state.
 */
export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
