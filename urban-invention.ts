import { DateTime } from "https://raw.githubusercontent.com/moment/luxon/2.0.2/src/luxon.js";

const CRON_MODE_DELAY = 30 * 1000;

class Context {
    token?: string;

    async query(query: string, variables?: Record<string, any>): Promise<any> {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }
        const response = await fetch("https://api.yourbcabus.com/graphql", {
            method: "POST",
            headers,
            body: JSON.stringify({
                query,
                variables
            })
        });
        const { data, errors } = await response.json();
        if (errors && errors.length > 0) {
            throw new Error(errors[0].message);
        } else {
            return data;
        }
    }

    async updateBusStatus(busID: string, boardingArea: string | undefined, invalidateTime: string): Promise<void> {
        await this.query(`mutation UpdateBusStatus($busID: ID!, $boardingArea: String, $invalidateTime: DateTime!) {
            updateBusStatus(busID: $busID, status: {boardingArea: $boardingArea, invalidateTime: $invalidateTime}) {
                id
            }
        }`, {busID, boardingArea, invalidateTime});
    }
}

async function sync(schoolID: string, spreadsheetID: string, googleKey: string, credentials?: {id: string, secret: string}) {
    console.log("Starting sync...");

    const ctx = new Context();
    if (credentials) {
        console.log("Obtaining token...");
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
        ctx.token = json.access_token;
        if (ctx.token) {
            console.log("Access token obtained.");
        } else {
            console.log("Access token missing.");
        }
    }

    const { school } = await ctx.query(`query GetSchool($schoolID: ID!) {
        school(id: $schoolID) {
            timeZone
            buses {
                id
                name
                boardingArea
                invalidateTime
            }
        }
    }`, {schoolID});
    console.log("Fetched school.");
    
    const ybbBuses = new Map<string, {id: string, name: string, boardingArea?: string, invalidateTime?: Date}>();
    school.buses.forEach((bus: {id: string, name: string, boardingArea?: string, invalidateTime?: string}) => {
        if (ybbBuses.has(bus.name)) return;
        ybbBuses.set(bus.name, {...bus, invalidateTime: bus.invalidateTime ? new Date(bus.invalidateTime) : undefined})
    });

    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetID}/values/Locations!A1:F?key=${googleKey}`);
    const res: {values: string[] | undefined} = await sheetsResponse.json();
    if (!res.values) {
        console.error(res);
        throw new Error("Values not present");
    }
    const { values } = res;
    values.splice(0, 1);
    console.log("Fetched sheet.");
    
    const sheetBuses = values.map(row => {
        const buses = [];
        if (row.length > 0 && row[0].length > 0) {
            const boardingArea = row.length > 1 ? row[1].trim().toUpperCase() : "";
            buses.push({
                name: row[0],
                boardingArea: boardingArea === "" ? undefined : boardingArea
            });
        }
        if (row.length > 3 && row[3].length > 0) {
            const boardingArea = row.length > 4 ? row[4].trim().toUpperCase() : "";
            buses.push({
                name: row[3],
                boardingArea: boardingArea === "" ? undefined : boardingArea
            });
        }
        return buses;
    }).flat();

    const invalidateTime = DateTime.now().setZone(school.timeZone ?? "UTC").startOf("day").plus({ days: 1 }).toUTC().toISO();
    for (const sheetBus of sheetBuses) {
        const ybbBus = ybbBuses.get(sheetBus.name);
        if (ybbBus) {
            const boardingArea = ybbBus.boardingArea;
            if ((boardingArea ?? undefined) !== sheetBus.boardingArea) {
                console.log(`Updating ${ybbBus.name} (${ybbBus.id}) to boarding area ${sheetBus.boardingArea}`);
                await ctx.updateBusStatus(ybbBus.id, sheetBus.boardingArea, invalidateTime);
            }
        } else {
            console.log(`Creating bus with name ${sheetBus.name}`);
            const { createBus: { id } } = await ctx.query(`mutation CreateBus($schoolID: ID!, $name: String) {
                createBus(schoolID: $schoolID, bus: {name: $name, otherNames: [], phone: [], available: true}) {
                    id
                }
            }`, {schoolID, name: sheetBus.name});
            console.log(`Updating ${sheetBus.name} (${id}) to boarding area ${sheetBus.boardingArea}`);
            await ctx.updateBusStatus(id, sheetBus.boardingArea, invalidateTime);
        }
    }

    console.log("Sync complete.");
}

const schoolID = Deno.env.get("SCHOOL_ID")!;
const spreadsheetID = Deno.env.get("SPREADSHEET_ID")!;
const googleKey = Deno.env.get("API_KEY");
const id = Deno.env.get("YBB_CLIENT_ID");
const secret = Deno.env.get("YBB_CLIENT_SECRET");
const credentials = (id && secret) ? {id, secret} : undefined;

if (Deno.env.get("CRON_MODE")) {
    console.log("Running in cron mode");
    while (true) {
        try {
            await sync(schoolID, spreadsheetID, googleKey!, credentials);
        } catch (e) {
            console.error(e);
            console.log("Sync interrupted.")
        }
        await new Promise(resolve => setTimeout(resolve, CRON_MODE_DELAY));
    }
} else {
    await sync(schoolID, spreadsheetID, googleKey!, credentials);
}
