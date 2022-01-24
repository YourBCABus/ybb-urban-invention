import fetch from "node-fetch";
import { readFile } from "fs/promises";

import { logger } from "./urban-invention.js";

type FormatVarsType = (...variables: any[]) => Record<string, unknown>;

export type Query<T, K extends FormatVarsType> = { queryText: string, validateFunction: (input: unknown) => T, formatVariables: K, queryName: string};


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

    public async query<T>(query: Query<T, FormatVarsType>, variables?: Record<string, unknown>, log: boolean = false): Promise<T> {
        if (log) logger.log(`Running query \`${query.queryName}\`...`);

        let output: T;

        logger.indent();
        {
            if (this.token && this.token.expiration.getTime() - 10000 <= new Date().getTime()) {
                logger.log("Token is invalid!");
                this.token = await this.newToken();
            }
            
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (this.token) {
                headers["Authorization"] = `Bearer ${this.token.bearer}`;
            }

            if (log) logger.log("Sending request to server...");
            const response = await fetch("https://api.yourbcabus.com/graphql", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    query: query.queryText,
                    variables,
                })
            });
            if (log) logger.log("Request completed!");

            const { data, errors } = (await response.json()) as any;
            if (errors && errors.length > 0) {
                logger.error(`Query ${query.queryName} failed! Throwing errors...`);
                logger.error(JSON.stringify(errors));
                throw errors[0];
            } else {
                output = query.validateFunction(data);
                if (log) logger.log("Query completed successfully!");
            }
        }
        logger.unindent();

        return output;
    }

    public async newToken(): Promise<Token> {
        logger.log("Attempting to get token from credentials...");

        let output;

        logger.indent();
        {
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
                logger.log("Access token obtained.");
            } else {
                throw Error("Access token permissions were denied.");
            }
            logger.log(`Token expiration: ${expiration}`);

            output = { bearer, expiration };
        }
        logger.unindent();

        return output;
    }
}
