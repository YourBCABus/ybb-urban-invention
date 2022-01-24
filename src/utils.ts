import * as readline from "readline";

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
        if (a === b) return;
        if (step === 0 || (a - b < 0 ? step < 0 : step > 0)) throw RangeError("Invalid range!");
        for (let i = a; a <= b ? i < b : i > b; i+= step) yield i;
    }
}

export const addProperty = <T, X extends string, V>(obj: T, propName: X, value: V): T & Record<X, V> => {
    // @ts-ignore
    obj[propName] = value;
    // @ts-ignore
    return obj;
};


export const extendRlInterface = (rlInterface: readline.Interface) => {
    return addProperty(
        rlInterface,
        "asyncQuestion",
        function(this: readline.Interface, query: string): Promise<string> {
            return new Promise(resolve => this.question(query, resolve));
        },
    );
};

export const askQuestion = async (question: string) => {
    const rl = extendRlInterface(readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    }));
    const response = await rl.asyncQuestion(question);
    rl.close();
    return response;
};

export function hasOwnProperty<X extends object, Y extends PropertyKey>(obj: X, prop: Y): obj is X & Record<Y, unknown> {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

export class Logger {
    private level: number;
    constructor(private startLevel: number = 0, private perIndent: number = 2) {
        this.level = startLevel;
    }

    public log(...args: any[]) {
        if (this.level <= 0) console.log(...args);
        else console.log(" ".repeat(this.level - 1), ...args);
    }

    public error(...args: any[]) {
        if (this.level <= 0) console.error(...args);
        else console.error(" ".repeat(this.level - 1), ...args);
    }

    public indent() {
        this.level += this.perIndent;
    }

    public unindent() {
        this.level -= this.perIndent;
    }

    public reset() {
        this.level = this.startLevel;
    }
}