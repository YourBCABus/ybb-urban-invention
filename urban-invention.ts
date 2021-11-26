import { DateTime } from "https://raw.githubusercontent.com/moment/luxon/2.0.2/src/luxon.js";

import Context from "./context.ts";
import ChangeQueue from "./changeQueue.ts";

import initRedis from "./redis.ts";

import getSchool from "./queries_mutations/getSchool.ts";
import createBus from "./queries_mutations/createBus.ts";
import updateBusStatus from "./queries_mutations/updateBusStatus.ts";

const CRON_MODE_DELAY = 30 * 1000;


type YbbBusMap = Map<string, {id: string, name: string, boardingArea?: string, invalidateTime?: Date}>;
async function getTzAndYbbBusMap(schoolID: string, ctx: Context): Promise<{ timeZone: string | null, ybbBuses: YbbBusMap }> {
    const { school } = await ctx.query(getSchool, {schoolID});
    console.log("Fetched school.");
    
    const ybbBuses: YbbBusMap = new Map();
    school.buses.forEach((bus) => {
        if (ybbBuses.has(bus.name)) return;
        ybbBuses.set(bus.name, bus)
    });
    console.log("Created bus map.")
    return { timeZone: school.timeZone, ybbBuses };
}

async function getSheetData(spreadsheetID: string, googleKey: string, range: string): Promise<string[][]> {
    const sheetsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetID}/values/${range}?key=${googleKey}`);
    const res: {values: string[][] | undefined} = await sheetsResponse.json();
    console.log("Fetched sheet.");

    if (!res.values) {
        console.error(res);
        throw new Error("Values not present.");
    }
    const { values } = res;
    console.log("Got sheet values.");

    return values;
}

type SheetChanges = {
    newBuses: Map<string, string>,
    boardingAreaChanges: Map<string, string>
};

function handleInitialSheetData(sheetData: readonly (readonly string[])[], busData: YbbBusMap): SheetChanges {
    const newBuses = new Map();
    const boardingAreaChanges = new Map();
    sheetData.forEach(row => {
        for (let i = 0; i + 1 < row.length; i += 3) {
            if (row[i + 1].trim()) {
                if (busData.has(row[i])) {
                    boardingAreaChanges.set(row[i], row[i + 1].trim());
                } else {
                    newBuses.set(row[i], row[i + 1].trim());
                }
            }
        }
    });

    return { newBuses, boardingAreaChanges };
}

function getSheetDiff(origData: readonly (readonly string[])[], newData: readonly (readonly string[])[], busData: YbbBusMap): SheetChanges {
    const zippedData = Array(Math.max(origData.length, newData.length))
        .fill(null)
        .map(
            (_, yIdx) => Array(Math.max((origData[yIdx] ?? []).length, (newData[yIdx] ?? []).length))
                .fill(null)
                .map((_, xIdx) => {return {origData: (origData[yIdx] ?? [])[xIdx] ?? "", newData: (newData[yIdx] ?? [])[xIdx] ?? ""}})
        );

    const newBuses = new Map();
    const boardingAreaChanges = new Map();
    zippedData.forEach(row => {
        for (let i = 0; i + 1 < row.length; i += 3) {
            if (row[i].origData !== row[i].newData || row[i + 1].origData !== row[i + 1].newData) {
                if (busData.has(row[i].newData)) {
                    boardingAreaChanges.set(row[i].newData, row[i + 1].newData.trim());
                } else {
                    if (row[i].newData.trim()) {
                        newBuses.set(row[i].newData, row[i + 1].newData.trim());
                    }
                }
            }
        }
    });

    return { newBuses, boardingAreaChanges };
}

function handleSheetData(origData: readonly (readonly string[])[] | undefined, newData: readonly (readonly string[])[], busData: YbbBusMap, copyOnInitial?: boolean): SheetChanges {
    if (origData === undefined) {
        if (copyOnInitial) return handleInitialSheetData(newData, busData);
        else return { newBuses: new Map(), boardingAreaChanges: new Map() };
    } else return getSheetDiff(origData, newData, busData);
}

async function sync(
    schoolID: string,
    oldSheetData: readonly (readonly string[])[] | undefined,
    spreadsheetID: string,
    googleKey: string,
    upDownEnables: {sheetToYbb: boolean, ybbToSheet: boolean},
    changeQueue: ChangeQueue,
    credentials?: {id: string, secret: string},
): Promise<readonly (readonly string[])[]> {
    console.log("Starting sync...");

    // Get credentials.
    const ctx = await Context.new(credentials);

    // Poll the Ybb backend to get a map of bus name to bus info.
    const { timeZone, ybbBuses } = await getTzAndYbbBusMap(schoolID, ctx);

    // Poll the Google Sheet to get an update on the location of the buses.
    const preEditValues: readonly (readonly string[])[] = (await getSheetData(spreadsheetID, googleKey, "Locations!A1:F")).slice(1);

    const values = upDownEnables.ybbToSheet ? changeQueue?.updateSheetTarget(preEditValues) : preEditValues;

    // Get changes on the sheet
    const { newBuses, boardingAreaChanges } = handleSheetData(oldSheetData, values, ybbBuses, true);

    if (upDownEnables.sheetToYbb) {
        const invalidateTime = DateTime.now().setZone(timeZone ?? "UTC").startOf("day").plus({ days: 1 }).toUTC().toISO();
        await Promise.all([
            ...Array.from(newBuses.entries()).map(async ([name, boardingArea]) => {
                console.log(`Creating bus with name ${name}`);
                const { createBus: { id } } = await ctx.query(createBus, createBus.formatVariables(schoolID, name));
                console.log(`Updating ${name} (${id}) to boarding area ${boardingArea}`);
                return await ctx.query(updateBusStatus, updateBusStatus.formatVariables(id, boardingArea, invalidateTime));
            }),
            ...Array.from(boardingAreaChanges.entries()).map(async ([name, boardingArea]) => {
                const ybbBus = ybbBuses.get(name);
                if (!ybbBus) return;
                console.log(`Updating ${ybbBus.name} (${ybbBus.id}) to boarding area ${boardingArea}`);
                return await ctx.query(updateBusStatus, updateBusStatus.formatVariables(ybbBus.id, boardingArea, invalidateTime));
            }),
        ]);
    }

    console.log("Sync complete.");
    return values;
}

const schoolID = Deno.env.get("SCHOOL_ID")!;
const spreadsheetID = Deno.env.get("SPREADSHEET_ID")!;
const googleKey = Deno.env.get("API_KEY");
const id = Deno.env.get("YBB_CLIENT_ID");
const secret = Deno.env.get("YBB_CLIENT_SECRET");
const credentials = (id && secret) ? {id, secret} : undefined;

const upDownEnables = { ybbToSheet: true, sheetToYbb: true };

const queuedChanges = new ChangeQueue();

initRedis(queuedChanges);

if (Deno.env.get("CRON_MODE")) {
    console.log("Running in cron mode");
    let oldSheetData: readonly (readonly string[])[] | undefined = undefined;
    while (true) {
        try {
            oldSheetData = await sync(schoolID, oldSheetData, spreadsheetID, googleKey!, upDownEnables, queuedChanges, credentials);
        } catch (e) {
            console.error(e);
            console.log("Sync interrupted.");
        }
        await new Promise(resolve => setTimeout(resolve, CRON_MODE_DELAY));
    }
} else {
    await sync(schoolID, undefined, spreadsheetID, googleKey!, upDownEnables, queuedChanges, credentials);
}
