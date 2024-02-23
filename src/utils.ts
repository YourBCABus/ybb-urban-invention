import { readFile } from "fs/promises";
import * as readline from "readline";
import { inspect } from "util";
import fetch, { Response } from "node-fetch";


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

/**
 * Adds property to type, while reflecting such in the return type.
 * 
 * @param obj the object to modify
 * @param propName the property name to add the value at
 * @param value the value to add at propName
 * @returns the object with the added type, so it is chainable
 */
export const addProperty = <T, X extends string, V>(obj: T, propName: X, value: V): T & Record<X, V> => {
    // @ts-ignore
    obj[propName] = value;
    // @ts-ignore
    return obj;
};

/**
 * This method is used to add an async version of the "question" method to a
 * readline interface.
 * THIS METHOD MUTATES THE PASSED RL INTERFACE.
 * 
 * @param rlInterface the readline interface to extend
 * @returns the extended interface
 */
export const extendRlInterface = (rlInterface: readline.Interface) => {
    return addProperty(
        rlInterface,
        "asyncQuestion",
        function(this: readline.Interface, query: string): Promise<string> {
            return new Promise(resolve => this.question(query, resolve));
        },
    );
};

/**
 * @param question the question to ask
 * @returns the response
 */
export const askQuestion = async (question: string) => {
    const rl = extendRlInterface(readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    }));
    const response = await rl.asyncQuestion(question);
    rl.close();
    return response;
};

/**
 * Utility function for query response type confirmation
 * 
 * @param obj the object to check the property against
 * @param prop the property to check the existance of on the object
 * @returns whether or not the property exists on said object
 */
export function hasOwnProperty<X extends object, Y extends PropertyKey>(obj: X, prop: Y): obj is X & Record<Y, unknown> {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

export interface LogTarget {
    log(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
}

/**
 * A utility class that provides hierarchical logging to help streamline the process of debugging.
 */
export class Logger {
    private targets: LogTarget[] = [];    
    
    private level: number;
    constructor(private startLevel: number = 0, private perIndent: number = 2) {
        this.level = startLevel;
    }

    /**
     * Sets the targets to forward any messages this logger recieves to.
     * 
     * @param targets the specified targets
     */
    public setTargets(...targets: LogTarget[]) {
        this.targets = targets.map(v => v);
    }

    /**
     * Very similar to console.log, but uses an indent.
     * 
     * @param args the arguments as if you were passing them to console.log
     */
    public log(...args: any[]): void {
        for (const target of this.targets) target.log(...this.getLevelPadder(), ...args);
    }
    
    /**
     * Very similar to console.info, but uses an indent.
     * 
     * @param args the arguments as if you were passing them to console.info
     */
     public info(...args: any[]): void {
        for (const target of this.targets) target.info(...this.getLevelPadder(), ...args);
    }

    /**
     * Very similar to console.info, but uses an indent.
     * 
     * @param args the arguments as if you were passing them to console.info
     */
     public warn(...args: any[]): void {
        for (const target of this.targets) target.warn(...this.getLevelPadder(), ...args);
    }

    /**
     * Not necessarily the same as console.error. For the local logging, it likely
     * will be, but it's not enforced for other types of logging.
     * 
     * @param args the arguments as if you were passing them to console.error
     */
    public error(...args: any[]): void {
        for (const target of this.targets) target.error(...this.getLevelPadder(), ...args);
    }

    public indent(): void {
        this.level += this.perIndent;
    }

    public unindent(): void {
        this.level -= this.perIndent;
    }

    /**
     * Resets the indent level of the logger.
     */
    public reset(): void {
        this.level = this.startLevel;
    }

    private getLevelPadder(): [] | [string] {
        return this.level ? [" ".repeat(this.level - 1)] : [];
    }
}

export class DiscordLogTarget implements LogTarget {
    private readonly rolePing;
    constructor(private url: string, roleID: string | undefined) {
        if (roleID) this.rolePing = `<@&${roleID}>`;
    }

    public static async newFromFile(fileName: string): Promise<DiscordLogTarget> {
        const file = await readFile(fileName, {encoding: 'utf-8'});
        const json = JSON.parse(file);
        return new DiscordLogTarget(json.url, json.roleID);
    }

    public log(..._: any[]): void {}
    
    public info(...args: any[]): void {
        // this.send(`${"```"}\n   INFO: ${args.map(arg => typeof arg === "string" ? arg : inspect(arg)).join(" ")}${"```"}`);
    }

    public warn(...args: any[]): void {
        this.send(`${"```"}\nWARNING: ${args.map(arg => typeof arg === "string" ? arg : inspect(arg)).join(" ")}${"```"}`);
    }

    public error(...args: any[]): void {
        this.send(`${
            this.rolePing ?? ""
        }\n${
            "```diff\n- ERROR:```"
        }${
            args
                .filter(arg => !(typeof arg === "string") || arg.trim())
                .map(arg => "```diff\n" + (typeof arg === "string" ? arg : inspect(arg)) + "```")
                .join("\n")
        }`);
    }

    private async send(message: string): Promise<Response | Error> {
        try {
            return await fetch(this.url, {
                "method":"POST",
                "headers": {"Content-Type": "application/json"},
                "body": JSON.stringify({
                    "content": message,
                })
            });
        } catch (err) {
            console.error(err);
            if (err instanceof Error) return err;
            else return new Error(String(err));
        }
    }
}
