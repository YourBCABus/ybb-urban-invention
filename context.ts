export function hasOwnProperty<X extends object, Y extends PropertyKey>(obj: X, prop: Y): obj is X & Record<Y, unknown> {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

type FormatVarsType = (...variables: any[]) => Record<string, unknown>;

export type Query<T, K extends FormatVarsType> = { queryText: string, validateFunction: (input: unknown) => T, formatVariables: K};

export default class Context {
    private token?: string;

    private constructor(token?: string) {
        this.token = token;
    }

    public async query<T>(query: Query<T, FormatVarsType>, variables?: Record<string, unknown>): Promise<T> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }
        const response = await fetch("https://api.yourbcabus.com/graphql", {
            method: "POST",
            headers,
            body: JSON.stringify({
                query: query.queryText,
                variables
            })
        });
        const { data, errors } = await response.json();
        if (errors && errors.length > 0) {
            throw new Error(errors[0].message);
        } else {
            return query.validateFunction(data);
        }
    }

    public static async newFromCreds(credentials: {id: string, secret: string}): Promise<Context> {
        console.log("Attempting to get token from credentials...");
        const response = await fetch("https://api.yourbcabus.com/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${encodeURIComponent(credentials.id)}&client_secret=${encodeURIComponent(credentials.secret)}&grant_type=client_credentials&scope=read%20bus.create%20bus.updateStatus`
        });
        const json = await response.json();
        if (json.error) {
            console.error(json);
        }
        const token = json.access_token;
        if (token) {
            console.log("Access token obtained.");
        } else {
            console.log("Failed to get access token.");
        }
        return new Context(token);
    }

    public static newBlank(): Context {
        console.log("Obtaining blank access token...");
        return new Context();
    }

    public static async new(credentials?: {id: string, secret: string}): Promise<Context> {
        if (credentials === undefined) {
            return this.newBlank();
        } else {
            return await this.newFromCreds(credentials);
        }
    }
}
