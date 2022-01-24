import { google } from "googleapis";
const sheets = google.sheets('v4');

import { readFile, writeFile } from "fs/promises";
import { Credentials, OAuth2Client } from "google-auth-library";

import { askQuestion } from "./utils.js";
import { logger } from "./urban-invention.js";

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'oauth-token.json';

interface ClientInfo {
    web: {
        client_secret: string;
        client_id: string;
        redirect_uris: string[];
    };
}
const initSheetsOAuthHelpers = {
    getOauthClient: async (clientInfo: Promise<ClientInfo>) => {
        let { web: { client_secret, client_id, redirect_uris } } = await clientInfo;
    
        return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    },
    getNewToken: (oAuth2Client: OAuth2Client, code: string): Promise<Credentials> => new Promise(
        (resolve, reject) => oAuth2Client.getToken(code, (err, token) => {
            if (err) reject(err);
            else resolve(token!);
        })
    ),
    promptForOauthToken: async (oAuth2Client: OAuth2Client) => {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: "offline",
            scope: SCOPES,
        });
        console.log("Authorize this app by visiting this url:", authUrl);
    
        return await initSheetsOAuthHelpers.getNewToken(
            oAuth2Client,
            decodeURIComponent(await askQuestion("Enter the code from that page here: ")),
        );
    },
};

async function initSheetsOAuth(): Promise<OAuth2Client> {
    // Destructure helper functions.
    const { getOauthClient, promptForOauthToken } = initSheetsOAuthHelpers;

    // Load oauth client info from a local file.
    let cliInfoPromise: Promise<ClientInfo> = readFile('oauth-credentials.json', "utf-8").then(JSON.parse).catch(err => {
        console.log('Error loading client secret file:', err);
        process.exit(1);
    });

    // Attempt to load the token 
    let tokenPromise = readFile(TOKEN_PATH, "utf-8").then(JSON.parse);

    let oAuth2Client: OAuth2Client;
    try {
        const token = await tokenPromise;

        oAuth2Client = await getOauthClient(cliInfoPromise);
        oAuth2Client.setCredentials(token);
    } catch (e) {
        oAuth2Client = await getOauthClient(cliInfoPromise);

        const token = await promptForOauthToken(oAuth2Client)
        oAuth2Client.setCredentials(token);

        // Store the token to disk for later program executions
        writeFile(TOKEN_PATH, JSON.stringify({...token, scopes: SCOPES}))
            .then(() => console.log(`Token stored to \`${TOKEN_PATH}\`.`))
            .catch(err => console.error(`Failed to store token to ${TOKEN_PATH}. Error:`, err));
    }
    return oAuth2Client;
}

const numToLetters = (num: number): string => num.toString(26).split("").map(num => String.fromCharCode(65 + parseInt(num, 26))).join("");

export const xyToRange = (x: number, y: number): string => `${numToLetters(x)}${y + 1}`;

export interface Update {
    values: string[][];
    majorDimension: "ROWS";
    range: `${string}!${string}:${string}`;
}

export default class SheetContext {
    private constructor(private auth: OAuth2Client, private id: string) {}

    public static async authenticateAndCreate(sheetId: string): Promise<SheetContext> {
        return new SheetContext(await initSheetsOAuth(), sheetId);
    }

    public async makeApiRequest(data: Update[]) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.id,
            requestBody: {
                valueInputOption: "RAW",
                data,
            },
            auth: this.auth,
        });

        // const response = (await sheets.spreadsheets.values.batchUpdate({
        //     spreadsheetId: this.id,
        //     requestBody: {
        //         valueInputOption: "USER_ENTERED",
        //         data,
        //     },
        //     auth: this.auth,
        // })).data;

        // Change code below to process the `response` object if we
        // actually need data from it in the future:
        // console.log(JSON.stringify(response, null, 2));
    }

    public async getSheet(): Promise<string[][]> {
        logger.log("Resquesting sheet data...");
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: this.id,
            majorDimension: "ROWS",
            auth: this.auth,
            valueRenderOption: "UNFORMATTED_VALUE",
            range: "Locations!A:ZZ"
        });
        const rawValues = response.data.values || [];
        logger.log("Sheet data obtained!");
        return rawValues.map(row => row.slice(0, 6).map(cell => String(cell)));
    }
}

// (async () => {
//     const context = await SheetContext.authenticateAndCreate(process.env.SPREADSHEET_ID!);

//     context.makeApiRequest([{
//         values: [["Hello!"]],
//         majorDimension: "ROWS",
//         range: `Locations!${xyToRange(6, 24)}:${xyToRange(6, 24)}`,
//     }]);

// })();
