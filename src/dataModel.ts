import getSchool, { ValidatedType as GetSchoolOutputType } from "./queries_mutations/getSchool.js";
import SheetContext, { Update, xyToRange } from "./sheetsIntegration.js";
import { logger } from "./urban-invention.js";
import { range } from "./utils.js";
import YbbContext from "./ybbContext.js";
import createBus from "./queries_mutations/createBus.js";
import getBus from "./queries_mutations/getBus.js";
import updateBus from "./queries_mutations/updateBus.js";
import updateBusStatus from "./queries_mutations/updateBusStatus.js";
import { DateTime } from "luxon";

type SheetPos = {x: number, y: number};
const posToString = (pos: SheetPos) => `${pos.x},${pos.y}`;

function getPosition(sheet: string[][], x: number, y: number) {
    const base = (sheet[y] ?? []).slice(x, x + 3);
    return [...base, ...Array.from(range(3)).map(() => "").slice(base.length)];
}

function mapPositions<T>(sheet: string[][], callback: (data: string[], pos: SheetPos) => T, runOnLocation: (data: string[], location: SheetPos) => boolean): T[] {
    const results = [];
    for (const i of range(sheet.length)) {
        for (const j of range(0, sheet[i].length, 3)) {
            const pos = {x: j, y: i};
            const data = getPosition(sheet, j, i);
            if (runOnLocation(data, pos)) results.push(callback(data, pos));
        }
    }

    return results;
}

function findPosition(sheet: string[][], predicate: (data: string[], pos: SheetPos) => boolean): SheetPos | undefined {
    for (const i of range(sheet.length)) {
        for (const j of range(0, sheet[i].length, 3)) {
            const pos = { x: j, y: i };
            if (predicate(getPosition(sheet, j, i), pos)) return pos;
        }
    }
}

export interface BusModel<T> {
    id: string | null;
    name: string | null;
    boardingArea: string | null;
    stale?: boolean;
    info: T;
}

export class SheetBusModel implements BusModel<SheetPos> {
    public stale: boolean = false;
    
    constructor(public id: string | null, public name: string, public boardingArea: string | null, public info: SheetPos) {}

    public updateFromSheet(sheet: string[][], usedPositions: Set<string>) {
        // See if the location has the name
        let data = getPosition(sheet, this.info.x, this.info.y);
        if (data[0].trim() !== this.name) {
            // If it doesn't, find a new position
            const newPos = findPosition(sheet, (data, pos) => data[0].trim() === this.name && !usedPositions.has(`${pos.x},${pos.y}`));
            if (newPos) {
                this.info = newPos;
                data = getPosition(sheet, newPos.x, newPos.y);
            }
        }

        // Update the bus info
        const [name, boardingArea] = data;
        if (this.name !== name.trim() || this.boardingArea !== boardingArea.trim()) this.stale = false;
        this.name = name.trim();
        this.boardingArea = boardingArea.trim();

        usedPositions.add(`${this.info.x},${this.info.y}`);
    }
}

interface BusNameUpdate {
    type: "BusNameUpdate";
    id: string;
    name: string | null;
}

interface BusBoardingAreaUpdate {
    type: "BusBoardingAreaUpdate";
    id: string;
    boardingArea: string | null;
}

interface BusCreate {
    type: "BusCreate";
    id: string | null;
    name: string | null;
    boardingArea: string | null;
    resolveID?(id: string): void;
}

interface BusDelete {
    type: "BusDelete";
    id: string;
}

export type BusDifference = BusNameUpdate | BusBoardingAreaUpdate | BusCreate | BusDelete;

export interface DataModel<T> {
    buses: BusModel<T>[];
}

export interface UpdatableDataModel<T, C> extends DataModel<T> {
    applyChanges(changes: BusDifference[], context: C): Promise<void>;
}

export interface FreeAreas {
    width: number;
    freeSpaces: number[][];
    numLeft: number;
}

export class SheetDataModel implements UpdatableDataModel<SheetPos, SheetContext> {
    constructor(public buses: SheetBusModel[]) {}

    public updateFromSheetAndYbb(rawSheet: string[][], ybbModel: YBBDataModel): void {
        logger.log("Updating sheet model...");
        logger.indent();
        {
            const sheet = rawSheet.slice(1);
    
            const usedPositions = new Set<string>();
            this.buses.forEach(bus => bus.updateFromSheet(sheet, usedPositions));
            
            const newBuses = mapPositions(
                sheet,
                (data, pos) => new SheetBusModel(null, data[0].trim(), data[1].trim(), pos),
                (data, pos) => data[0].trim().length !== 0 && !usedPositions.has(`${pos.x},${pos.y}`)
            );
            this.buses.push(...newBuses);
            this.buses = this.buses.filter(bus => bus.name).map(bus => {
                if (!bus.id) {
                    const id = ybbModel.buses.find(ybbBus => ybbBus.name === bus.name)?.id ?? null;
                    bus.id = id;
                }
                bus.boardingArea ||= null;
                return bus;
            });
        }
        logger.unindent();
    }

    private calcFreeSpaces(oldAreas?: FreeAreas): FreeAreas {
        if (oldAreas) return {
            width: oldAreas.width, 
            freeSpaces: [...oldAreas.freeSpaces, Array.from(range(0, oldAreas.width, 3))],
            numLeft: oldAreas.numLeft + Math.ceil(oldAreas.width / 3), 
        }
        else {
            const busCells = this.buses.map(bus => bus.info);
            
            busCells.sort((a, b) => (a.y - b.y) || (a.x - b.x));

            const { x, y, } = busCells.reduce(
                (currMax, newLoc) => ({ x: Math.max(currMax.x, newLoc.x), y: Math.max(currMax.y, newLoc.y) }),
                { x: 0, y: 0 }
            );

            const maxX = x + 1 + (x + 1) % 3;
            const maxY = y + 1;

            const availableCells: number[][] = Array.from(range(maxY + 1)).map(() => []);
            let numAvailable = 0;

            Array.from(range(maxY + 1)).forEach(
                y => Array.from(range(0, maxX, 3)).forEach(
                    x => {
                        if ((busCells[0] && posToString(busCells[0])) === posToString({ x, y })) busCells.shift();
                        else {
                            availableCells[y].push(x);
                            numAvailable++;
                        }
                    }
                )
            );

            return {
                width: maxX,
                freeSpaces: availableCells,
                numLeft: numAvailable,
            };
        }
    }

    private diffToUpdate(diff: BusDifference, freeSpaces: FreeAreas): Update | undefined {
        switch (diff.type) {
            case "BusNameUpdate": {
                let { x, y } = this.buses.find(bus => bus.id === diff.id)!.info;

                return {
                    values: [[diff.name ?? ""]],
                    majorDimension: "ROWS",
                    range: `Locations!${xyToRange(x, y + 1)}:${xyToRange(x, y + 1)}`,
                };
            }

            case "BusBoardingAreaUpdate": {
                let { x, y } = this.buses.find(bus => bus.id === diff.id)!.info;

                return {
                    values: [[diff.boardingArea ?? ""]],
                    majorDimension: "ROWS",
                    range: `Locations!${xyToRange(x + 1, y + 1)}:${xyToRange(x + 1, y + 1)}`,
                };
            }

            case "BusCreate": {
                const y = freeSpaces.freeSpaces.findIndex(row => typeof row[0] === "number");
                const x = freeSpaces.freeSpaces[y].shift()!;

                freeSpaces.numLeft--;

                return {
                    values: [[diff.name ?? "", diff.boardingArea ?? ""]],
                    majorDimension: "ROWS",
                    range: `Locations!${xyToRange(x, y + 1)}:${xyToRange(x + 1, y + 1)}`,
                };
            }

            case "BusDelete": {
                let { x, y } = this.buses.find(bus => bus.id === diff.id)!.info;

                return {
                    values: [[""]],
                    majorDimension: "ROWS",
                    range: `Locations!${xyToRange(x, y + 1)}:${xyToRange(x, y + 1)}`,
                };
            }
        }
    }

    // Updates the model and applies the changes to Google Sheets.
    async applyChanges(changes: BusDifference[], context: SheetContext): Promise<void> {
        let freeSpaces = this.calcFreeSpaces();
        const updates = [];
        for (const diff of changes) {
            let possUpdate = this.diffToUpdate(diff, freeSpaces)
            if (possUpdate) updates.push(possUpdate);
            if (freeSpaces.numLeft === 0) freeSpaces = this.calcFreeSpaces(freeSpaces);
        }

        context.makeApiRequest(updates);
    }
}

export class YBBDataModel implements UpdatableDataModel<undefined, YbbContext> {
    constructor(public buses: BusModel<undefined>[], public deactivatedBuses: BusModel<undefined>[], public timeZone: string | null = null) {}

    public async updateFromYBB(context: YbbContext): Promise<void> {
        logger.log("Updating YBBDataModel instance from YBB servers...");
        logger.indent();
        {
            logger.log("Getting new data from YBB...");
            const { school } = await context.query(getSchool, {schoolID: context.schoolId}, true);
            this.timeZone = school.timeZone;

            const newBusInfo = school.buses;
            const newBuses: GetSchoolOutputType["school"]["buses"] = [];

            logger.log("Processing new YBB data [sorting into new/updated]...");
            logger.indent();
            const busIds = new Set<string>();
            this.deactivatedBuses = [];
            {
                newBusInfo.forEach(newBus => {
                    const idx = this.buses.findIndex(bus => bus.id === newBus.id);
                    if (idx !== -1) {
                        if (newBus.available) {
                            const bus = this.buses[idx];

                            let updatedArr = [];

                            const newName = newBus.name ?? null;
                            if (bus.name !== newName) {
                                bus.name = newName;
                                bus.stale = false;
                                updatedArr.push("Name");
                            }

                            const invalidated = (newBus.invalidateTime ?? new Date(0)) > new Date(Date.now());
                            const newBoardingArea = invalidated ? newBus.boardingArea ?? null : null;
                            if (bus.boardingArea !== newBoardingArea) {
                                bus.boardingArea = newBoardingArea;
                                bus.stale = false;
                                updatedArr.push("Boarding Area");
                            }

                            const updatedString = updatedArr.join(", ");
                            if (updatedArr.length === 0) logger.log(`${bus.id} - Nothing updated`);
                            else logger.log(`${bus.id} - ${updatedString} updated`);
                            busIds.add(newBus.id);
                        }
                    } else if (newBus.name && newBus.available) {
                        logger.log(`New bus: ${newBus.name} (${newBus.id})`);
                        newBuses.push(newBus);
                    }

                    if (newBus.name && !newBus.available) {
                        this.deactivatedBuses.push({id: newBus.id, name: newBus.name, boardingArea: null, info: undefined})
                    }
                });
            }
            logger.unindent();

            this.buses = this.buses.filter(
                bus => bus.id && busIds.has(bus.id)
            ).concat(newBuses.map(bus => {
                const invalidated = (bus.invalidateTime ?? new Date(0)) > new Date(Date.now());
                return {
                    id: bus.id,
                    name: bus.name ?? null,
                    boardingArea: invalidated ? bus.boardingArea ?? null : null,
                    info: undefined,
                    stale: false,
                };
            }));
        }
        logger.unindent();
    }

    getInvalidateTime(): string {
        return DateTime.local().setZone(this.timeZone || "UTC").endOf("day").toISO();
    }

    // Updates the model and applies the changes to the YourBCABus backend.
    async applyChanges(changes: BusDifference[], context: YbbContext): Promise<void> {
        const queries: (() => PromiseLike<void>)[] = [];
        const invalidateTime = this.getInvalidateTime();
        for (const diff of changes) {
            switch (diff.type) {
                case "BusNameUpdate": {
                    const { id } = diff;
                    queries.push(async () => {
                        const { bus } = await context.query(getBus, getBus.formatVariables(id));
                        await context.query(updateBus, updateBus.formatVariables(id, {...bus, name: diff.name}));
                    });
                    break;
                }

                case "BusBoardingAreaUpdate": {
                    const { id, boardingArea } = diff;
                    queries.push(async () => {
                        await context.query(updateBusStatus, updateBusStatus.formatVariables(id, boardingArea, invalidateTime));
                    });
                    break;
                }

                case "BusCreate": {
                    const { boardingArea, resolveID } = diff;
                    queries.push(async () => {
                        let id: string;

                        // Are there any deactivated buses we can reuse?
                        const deactivatedBus = this.deactivatedBuses.find(bus => bus.boardingArea === boardingArea);
                        if (deactivatedBus) {
                            this.deactivatedBuses = this.deactivatedBuses.filter(bus => bus !== deactivatedBus);

                            // Mark the bus as active.
                            id = deactivatedBus.id!;
                            const { bus } = await context.query(getBus, getBus.formatVariables(id));
                            await context.query(updateBus, updateBus.formatVariables(id, { ...bus, available: true }));
                        } else {
                            // Create a new bus.
                            const { createBus: data } = await context.query(createBus, createBus.formatVariables(context.schoolId, diff.name));
                            id = data.id;
                        }

                        if (resolveID) resolveID(id);
                        if (diff.boardingArea) {
                            await context.query(updateBusStatus, updateBusStatus.formatVariables(id, boardingArea, invalidateTime));
                        }
                    });
                    break;
                }

                case "BusDelete": {
                    const { id } = diff;
                    queries.push(async () => {
                        const { bus } = await context.query(getBus, getBus.formatVariables(id));
                        await context.query(updateBus, updateBus.formatVariables(id, { ...bus, available: false }));
                        await context.query(updateBusStatus, updateBusStatus.formatVariables(id, null, invalidateTime));
                    });
                }
            }
        }

        await Promise.all(queries.map(query => query()));
    }
}

export class GroundTruthDataModel implements DataModel<((id: string) => void) | undefined> {
    constructor(public buses: BusModel<((id: string) => void) | undefined>[]) {}

    // Diffs the two data models and returns a list of updates and new buses in other.
    diffIncomingChanges(other: DataModel<unknown>): BusDifference[] {
        const updates: BusDifference[] = [];
        const newBuses: BusModel<unknown>[] = [];
        const otherBuses = other.buses;
        for (const bus of this.buses) {
            const otherBus = otherBuses.find(otherBus => otherBus.id === bus.id);
            if (otherBus && !otherBus.stale) {
                if (bus.name !== otherBus.name) updates.push({ type: "BusNameUpdate", id: otherBus.id!, name: otherBus.name });
                if (bus.boardingArea !== otherBus.boardingArea) updates.push({ type: "BusBoardingAreaUpdate", id: otherBus.id!, boardingArea: otherBus.boardingArea });
            } else if (bus.id && !otherBus?.stale) {
                updates.push({ type: "BusDelete", id: bus.id });
            }
        }

        for (const bus of otherBuses) {
            if (!this.buses.some(thisBus => thisBus.id === bus.id)) {
                newBuses.push(bus)
            }
            if (bus.stale === false) bus.stale = true;
        }

        return [...updates, ...newBuses.map(bus => {
            const change: BusCreate = { type: "BusCreate", id: bus.id, name: bus.name, boardingArea: bus.boardingArea };
            if (!bus.id) {
                change.resolveID = id => {
                    bus.id = id;
                };
            }
            return change;
        })];
    }

    // Diffs the two data models and returns a list of changes.
    diffOutgoingChanges(other: DataModel<unknown>): BusDifference[] {
        const updates: BusDifference[] = [];
        const otherBuses = other.buses;
        for (const bus of this.buses) {
            const otherBus = otherBuses.find(otherBus => otherBus.id === bus.id);
            if (otherBus) {
                if (bus.name !== otherBus.name) updates.push({ type: "BusNameUpdate", id: bus.id!, name: bus.name });
                if (bus.boardingArea !== otherBus.boardingArea) updates.push({ type: "BusBoardingAreaUpdate", id: bus.id!, boardingArea: bus.boardingArea });
            } else {
                updates.push({
                    type: "BusCreate",
                    id: bus.id,
                    name: bus.name,
                    boardingArea: bus.boardingArea,
                    resolveID(id) {
                        if (bus.info) bus.info(id);
                    },
                });
            }
        }
        
        for (const bus of otherBuses) {
            if (bus.id && !this.buses.some(thisBus => thisBus.id === bus.id)) {
                updates.push({ type: "BusDelete", id: bus.id });
            }
        }

        return updates;
    }

    public update(ybbDataModel?: YBBDataModel, sheetsDataModel?: SheetDataModel) {
        // Diff the changes.
        const ybbChanges = ybbDataModel ? this.diffIncomingChanges(ybbDataModel) : [];
        const sheetsChanges = sheetsDataModel ? this.diffIncomingChanges(sheetsDataModel) : [];

        // Deduplicate the changes, giving priority to YBB changes.
        const changes: BusDifference[] = [];
        const seenNameChanges = new Set<string>();
        const seenBoardingAreaChanges = new Set<string>();
        const seenBusCreationNames = new Set<string | null>();
        const seenDeletes = new Set<string>();
        ybbChanges.forEach(change => {
            if (change.type === "BusNameUpdate") {
                seenNameChanges.add(change.id);
            } else if (change.type === "BusBoardingAreaUpdate") {
                seenBoardingAreaChanges.add(change.id);
            } else if (change.type === "BusCreate") {
                seenBusCreationNames.add(change.name);
            } else if (change.type === "BusDelete") {
                seenDeletes.add(change.id);
            }
            changes.push(change);
        });
        sheetsChanges.forEach(change => {
            if (change.type === "BusNameUpdate" && !seenNameChanges.has(change.id)) {
                seenNameChanges.add(change.id);
                changes.push(change);
            } else if (change.type === "BusBoardingAreaUpdate" && !seenBoardingAreaChanges.has(change.id)) {
                seenBoardingAreaChanges.add(change.id);
                changes.push(change);
            } else if (change.type === "BusCreate" && !seenBusCreationNames.has(change.name)) {
                seenBusCreationNames.add(change.name);
                changes.push(change);
            } else if (change.type === "BusDelete" && !seenDeletes.has(change.id)) {
                seenDeletes.add(change.id);
                changes.push(change);
            }
        });

        // Apply the changes.
        changes.forEach(change => {
            if (change.type === "BusNameUpdate") {
                const bus = this.buses.find(bus => bus.id === change.id);
                if (bus) bus.name = change.name;
            } else if (change.type === "BusBoardingAreaUpdate") {
                const bus = this.buses.find(bus => bus.id === change.id);
                if (bus) bus.boardingArea = change.boardingArea;
            } else if (change.type === "BusCreate") {
                const bus: BusModel<((id: string) => void) | undefined> = {
                    id: change.id,
                    name: change.name,
                    boardingArea: change.boardingArea,
                    info: undefined,
                };
                if (!change.id) {
                    bus.info = id => {
                        bus.id = id;
                        bus.info = undefined;
                        if (change.resolveID) {
                            change.resolveID(id);
                        }
                    };
                }
                this.buses.push(bus);
            } else if (change.type === "BusDelete") {
                this.buses = this.buses.filter(bus => bus.id !== change.id);
            }
        });
    }
}


export default interface DataModels {
    sheet: SheetDataModel;
    ybb: YBBDataModel;
    truth: GroundTruthDataModel
}