// Merge two arrays, either of which may be undefined.
export function mergeArr<A, B>(arr1: A[] | undefined, arr2: B[] | undefined): (A | B)[] {
  return [...(arr1 || []), ...(arr2 || [])]
}

// Converts a string to an array of code units based on UTF-8 width.
export function utf8ByteToCodeUnitMap(text: string): number[] {
  const encoder = new TextEncoder()
  const map: number[] = []

  let bytePos = 0

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!
    const char = String.fromCodePoint(cp)
    const bytes = encoder.encode(char)

    for (let b = 0; b < bytes.length; b++) {
      map[bytePos + b] = i
    }

    bytePos += bytes.length
    i += char.length
  }

  map[bytePos] = text.length
  return map
}
