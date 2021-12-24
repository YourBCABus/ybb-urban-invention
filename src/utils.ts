/**
 * Returns a generator over a numeric range, similar to range() in Python.
 * @param a the start of the range (inclusive), or if b is not specified, the end of the range (exclusive)
 * @param b the end of the range (exclusive)
 * @param step the step size (defaults to 1)
 */
export function* range(a: number, b?: number, step: number = 1): Generator<number> {
    if (b === undefined) {
        if (a < 0) throw RangeError("Invalid range!");
        for (let i = 0; i < a; i++) yield i;
    } else {
        if (step === 0 || (a - b < 0 ? step < 0 : step > 0)) throw RangeError("Invalid range!");
        for (let i = a; a <= b ? i < b : i > b; i+= step) yield i;
    }
}