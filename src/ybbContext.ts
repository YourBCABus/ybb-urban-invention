import fetch from "node-fetch";
import { readFile } from "fs/promises";

import { logger } from "./urban-invention.js";

type FormatVarsType = (...variables: any[]) => Record<string, unknown>;

export type Query<T, K extends FormatVarsType> = {
    queryText: string;
    validateFunction: (input: unknown) => T;
    formatVariables: K;
    queryName: string;
};


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
        log: boolean = false
    ): Promise<R> {
        if (log) logger.log(`Running query \`${query.queryName}\`...`);

        let output: R;

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

    /**
     * Uses the credentials, (this.clientId and this.clientSecret) to regenerate the
     * client token, which automatically expires after a short amount of time.
     * 
     * @returns the newly generated token
     */
    private async newToken(): Promise<Token> {
        logger.log("Attempting to get token from credentials...");

        let output: Token;

        logger.indent();
        {
            if (!(this.clientId && this.secret)) throw Error("Credentials missing!");

            const response = await fetch("https://api.yourbcabus.com/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: this.getTokenReqBody(),
            });
            const json = (await response.json()) as any;
            if (json.error || !json.access_token) {
                throw Error(json);
            }
            const bearer: string = json.access_token;
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

    /**
     * @returns The body of the request, verified with credentials.
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
        const scopeStr = encodeURIComponent(credentials.join(" "));

        return `${credStr}&${grantStr}&${scopeStr}`;
    }
}
