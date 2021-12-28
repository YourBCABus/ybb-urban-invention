import fetch from "node-fetch";
import { readFile } from "fs/promises";


type FormatVarsType = (...variables: any[]) => Record<string, unknown>;

export type Query<T, K extends FormatVarsType> = { queryText: string, validateFunction: (input: unknown) => T, formatVariables: K};


type Token = { bearer: string, expiration: Date };

export default class YbbContext {
    private token?: Token;

    public constructor(public schoolId: string, private clientId?: string, private secret?: string) {
        this.token = clientId && secret ? {
            bearer: "",
            expiration: new Date(0),
        } : undefined;
    }

    public static async newFromFile(schoolId: string, file: string): Promise<YbbContext> {
        const { id, secret } = await readFile(file, "utf-8").then(JSON.parse);
        return new YbbContext(schoolId, id, secret);
    }

    public async query<T>(query: Query<T, FormatVarsType>, variables?: Record<string, unknown>): Promise<T> {
        if (
            this.token && this.token.expiration.getTime() - 10000 <= new Date().getTime()
        ) this.token = await this.newToken();
        
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }

        const response = await fetch("https://api.yourbcabus.com/graphql", {
            method: "POST",
            headers,
            body: JSON.stringify({
                query: query.queryText,
                variables,
            })
        });
        const { data, errors } = (await response.json()) as any;
        if (errors && errors.length > 0) {
            throw errors[0];
        } else {
            return query.validateFunction(data);
        }
    }

    public async newToken(): Promise<Token> {
        console.log("Attempting to get token from credentials...");
        if (!(this.clientId && this.secret)) throw Error("Credentials missing!");
        const response = await fetch("https://api.yourbcabus.com/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.secret)}&grant_type=client_credentials&scope=read%20bus.create%20bus.update%20bus.updateStatus`,
        });
        const json = (await response.json()) as any;
        if (json.error || !json.access_token) {
            throw Error(json);
        }
        const bearer = json.access_token;
        const expiration = new Date(json.expires_in * 1000 + new Date().getTime());
        if (bearer) {
            console.log("Access token obtained.");
        } else {
            throw Error("");
        }
        console.log(`Token expiration: ${expiration}`);
        return { bearer, expiration };
    }
}
