import fetch from "node-fetch";
import { readFile } from "fs/promises";

import { logger } from "./urban-invention.js";
import { inspect } from "util";

type FormatVarsType = (...variables: any[]) => Record<string, unknown>;

export type Query<T, K extends FormatVarsType> = {
    queryText: string;
    validateFunction: (input: unknown) => T;
    formatVariables: K;
    queryName: string;
};


class QueryError extends Error {
    public constructor(public error: any, public query: Query<any, any>) {
        super();
    }

    private formatQueryError(): string {
        const mainErrText = `QueryError [${this.error.extensions.code}]: ${this.error.message}`;
    
        const splitFormattedQueryText = this
            .query
            .queryText
            .split("\n")
            .map(str => `+ ${str}`);
    
        for (const { line, column } of this.error.locations) {
            const lineIdx = line - 1;

            const cutText = splitFormattedQueryText[lineIdx].slice(2);

            splitFormattedQueryText[lineIdx] = `- ${cutText}\n- ${" ".repeat(column - 1)}^`;
        }
    
        const formattedQueryText = splitFormattedQueryText.join("\n").trim();
    
        return `${mainErrText}\n\n${formattedQueryText}`; 
    }

    public [inspect.custom](): string {
        return this.formatQueryError();
    }
}

type Token = { bearer: string, expiration: Date };

/**
 * YBBContext represents a set of client credentials, associated with a school,
 * which can be used to create, read, update, and delete data structures. It can
 * be constructed directly, or from a file. You may perform a query, (which is
 * actually either a query or mutation,) which can be used to read or update
 * data from the server.
 * 
 * 
 */
export default class YbbContext {
    private static readonly MAX_TRIES = 5;
    private static readonly TOKEN_REQUEST_DELAY = 5000;

    private token?: Token;

    /**
     * The ID of the target school to run queries and mutations on. Try not to
     * change this after construction.
     */
    public readonly schoolId: string;
    private clientId?: string;
    private secret?: string;

    /**
     * Direct constructor for YBBContext. It can be used when hard-coding values.
     * When possible though, try to use an (git-untracked) file, (like
     * `./ybb-credentials.json`) to help modularize it.
     * 
     * @param schoolId The id of the target school that you want to sync.
     * @param clientId The client id of the urban-invention instance's client.
     * @param secret The client secrent of the afforementioned client.
     * 
     * @returns The YbbContext constructed from the credentials provided, matched
     *          with the school associated with the provided ID
     */
    public constructor(schoolId: string, clientId?: string, secret?: string) {
        this.schoolId = schoolId;
        this.clientId = clientId;
        this.secret = secret;

        this.token = clientId && secret ? {
            bearer: "",
            expiration: new Date(0),
        } : undefined;
    }

    /**
     * Preferred method of creating a YbbContext. This function asychronously pulls
     * the required credentials from the specified file to enable
     * intercommunication.
     * 
     * @param schoolId The id of the school to read and update data from.
     * @param file The path to the file to get the credentials from.
     * 
     * @returns The YbbContext with the credentials with the provided file, for the
     * associated school to the private ID
     */
    public static async newFromFile(schoolId: string, file: string): Promise<YbbContext> {
        const { id, secret } = await readFile(file, "utf-8").then(JSON.parse);
        return new YbbContext(schoolId, id, secret);
    }

    /**
     * This method can be used to make queries and mutations to YBB's GraphQL API
     * 
     * @param query The query/mutation to be run. 
     * @param variables The variables formatted by the `Query.formatVariables`
     * function
     * @param log This enables or disables logging messages
     * 
     * @returns The result of the query, as denoted by the type X in Query<X, _>
     */
    public async query<R, F extends FormatVarsType>(
        query: Query<R, F>,
        variables?: ReturnType<F>,
        log: boolean = true
    ): Promise<R> {
        if (log) logger.log(`Running query \`${query.queryName}\`...`);

        let output: R;

        logger.indent();
        {
            if (this.token && this.token.expiration.getTime() - 10000 <= new Date().getTime()) {
                logger.info("Token is invalid!");
                this.token = await this.newToken();
            }
            
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (this.token) {
                headers["Authorization"] = `Bearer ${this.token.bearer}`;
            }

            if (log) logger.log("Sending request to server...");

            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 5000);
            const response = await fetch("https://api.yourbcabus.com/graphql", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    query: query.queryText,
                    variables,
                    signal: controller.signal,
                }),
            });
            clearTimeout(id);
            if (log) logger.log("Request completed!");

            const { data, errors: rawErrs } = (await response.json()) as any;
            if (rawErrs && rawErrs.length > 0) {
                this.token = undefined;
                const errors = rawErrs.map((err: any) => new QueryError(err, query));
                logger.error(`Query ${query.queryName} failed! Throwing errors...`);
                logger.error(...errors);
                throw errors[0];
            } else {
                output = query.validateFunction(data);
                if (log) logger.log("Query completed successfully!");
            }
        }
        logger.unindent();

        return output;
    }

    /**
     * Uses the credentials, (this.clientId and this.clientSecret) to regenerate the
     * client token, which automatically expires after a short amount of time.
     * 
     * @returns the newly generated token
     */
    private async newToken(): Promise<Token> {
        logger.info("Attempting to get token from credentials...");

        let output: Token;

        let tries = 0;

        logger.indent();
        {
            while (true) {
                if (!(this.clientId && this.secret)) throw Error("Credentials missing!");
    
                const body = this.getTokenReqBody();

                const response = await fetch("https://api.yourbcabus.com/token", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body,
                });
                const json = (await response.json()) as any;
                if (json.error || !json.access_token) {
                    throw Error(json);
                }
                const bearer: string = json.access_token;
                const expiration = new Date(json.expires_in * 1000 + new Date().getTime());
                if (bearer) {
                    logger.info("Access token obtained.");
                    output = { bearer, expiration };
                    break;
                } else {
                    if (tries >= YbbContext.MAX_TRIES) {
                        let millisWait = Math.round(YbbContext.TOKEN_REQUEST_DELAY * 1.5 ** (tries - YbbContext.MAX_TRIES + 1));
                        logger.error(new TokenError(json, tries, millisWait));
                        await new Promise(resolve => setTimeout(resolve, YbbContext.TOKEN_REQUEST_DELAY));
                    } else {
                        logger.warn("Access token permissions were denied.");
                        await new Promise(resolve => setTimeout(resolve, YbbContext.TOKEN_REQUEST_DELAY));
                    }
                    continue;
                }
            }
            logger.log(`Token expiration: ${output.expiration}`);
        }
        
        logger.unindent();

        return output;
    }

    /**
     * @returns The formatted body of the request, verified with credentials.
     */
    private getTokenReqBody(): string {
        const credentials = [
            this.clientId !== undefined ? `client_id=${encodeURIComponent(this.clientId)}` : "",
            this.secret !== undefined ? `client_secret=${encodeURIComponent(this.secret)}` : "",
        ];

        const grantType = "grant_type=client_credentials";

        const scopes = [
            "read",
            "bus.create",
            "bus.update",
            "bus.updateStatus",
        ];

        const credStr = credentials.join("&");
        const grantStr = grantType;
        const scopeStr = encodeURIComponent(scopes.join(" "));

        return `${credStr}&${grantStr}&scope=${scopeStr}`;
    }
}

/**
 * This class is built and logged when the application fails to get an access
 * token more than a set number of times.
 */
export class TokenError extends Error {
    constructor(tokenJson: any, tries: number, millisWait: number) {
        super(tokenJson)
        this.name = "Token Error";
        this.message = `Failed to obtain YBB Bearer ${tries} times. (Trying again in ${millisWait / 1000} seconds)\n  Response: ${inspect(tokenJson)}`;
    }
}

