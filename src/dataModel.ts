import getSchool, { ValidatedType as GetSchoolOutputType } from "./queries_mutations/getSchool.js";
import SheetContext, { Update, xyToRange } from "./sheetsIntegration.js";
import { range } from "./utils.js";
import YbbContext from "./ybbContext.js";

type SheetPos = {x: number, y: number};

function getPosition(sheet: string[][], x: number, y: number) {
    const base = sheet[y].slice(x, x + 3);
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
}

export type BusDifference = BusNameUpdate | BusBoardingAreaUpdate | BusCreate;

export interface DataModel<T> {
    buses: BusModel<T>[];
}

export interface UpdatableDataModel<T, C> extends DataModel<T> {
    applyChanges(changes: BusDifference[], context: C): Promise<void>;
}

export class SheetDataModel implements UpdatableDataModel<SheetPos, SheetContext> {
    constructor(public buses: SheetBusModel[]) {}

    public updateFromSheetAndYbb(rawSheet: string[][], ybbModel: YBBDataModel): void {
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

    diffToUpdate(diff: BusDifference): Update | undefined {
        switch (diff.type) {
            case "BusNameUpdate": {
                console.log("ToSheetChange", diff);
                let { x, y } = this.buses.find(bus => bus.id === diff.id)!.info;

                return {
                    values: [[diff.name ?? ""]],
                    majorDimension: "ROWS",
                    range: `Locations!${xyToRange(x, y + 1)}:${xyToRange(x, y + 1)}`,
                }
            }

            case "BusBoardingAreaUpdate": {
                let { x, y } = this.buses.find(bus => bus.id === diff.id)!.info;

                return {
                    values: [[diff.boardingArea ?? ""]],
                    majorDimension: "ROWS",
                    range: `Locations!${xyToRange(x + 1, y + 1)}:${xyToRange(x + 1, y + 1)}`,
                }
            }

            case "BusCreate": {
            }
        }
    }

    // Updates the model and applies the changes to Google Sheets.
    async applyChanges(changes: BusDifference[], context: SheetContext): Promise<void> {
        context.makeApiRequest(changes.map(diff => this.diffToUpdate(diff)).filter(update => update) as Update[]);
    }
}

export class YBBDataModel implements UpdatableDataModel<undefined, YbbContext> {
    constructor(public buses: BusModel<undefined>[]) {}

    public async updateFromYBB(context: YbbContext): Promise<void> {
        const { school } = await context.query(getSchool, {schoolID: context.schoolId});
        const newBusInfo = school.buses;
        const newBuses: GetSchoolOutputType["school"]["buses"] = [];
        newBusInfo.forEach(newBus => {
            const idx = this.buses.findIndex(bus => bus.id === newBus.id);
            if (idx !== -1) {
                const bus = this.buses[idx];


                const newName = newBus.name ?? null;
                if (bus.name !== newName) {
                    bus.name = newName;
                    bus.stale = false;
                }

                const invalidated = (newBus.invalidateTime ?? new Date(0)) > new Date(Date.now());
                const newBoardingArea = invalidated ? newBus.boardingArea ?? null : null;
                if (bus.boardingArea !== newBoardingArea) {
                    bus.boardingArea = newBoardingArea;
                    bus.stale = false;
                }
            } else newBuses.push(newBus);
        });
        this.buses.push(
            ...newBuses.filter(bus => bus.name).map(bus => {
                const invalidated = (bus.invalidateTime ?? new Date(0)) > new Date(Date.now());
                return {
                    id: bus.id,
                    name: bus.name ?? null,
                    boardingArea: invalidated ? bus.boardingArea ?? null : null,
                    info: undefined,
                    stale: false,
                };
            })
        );
        console.log(this.buses);
    }

    // Updates the model and applies the changes to the YourBCABus backend.
    async applyChanges(changes: BusDifference[], context: YbbContext): Promise<void> {
        
    }
}

export class GroundTruthDataModel implements DataModel<undefined> {
    constructor(public buses: BusModel<undefined>[]) {}

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
            }
        }

        for (const bus of otherBuses) {
            if (!this.buses.some(thisBus => thisBus.id === bus.id)) newBuses.push(bus);
            if (bus.stale === false) bus.stale = true;
        }

        return [...updates, ...newBuses.map(bus => ({ type: "BusCreate" as "BusCreate", id: bus.id, name: bus.name, boardingArea: bus.boardingArea }))];
    }

    // Diffs the two data models and returns a list of changes.
    diffOutgoingChanges(other: DataModel<unknown>): BusDifference[] {
        const updates: BusDifference[] = [];
        const otherBuses = other.buses;
        for (const bus of this.buses) {
            console.log(bus.name);
            const otherBus = otherBuses.find(otherBus => otherBus.id === bus.id);
            if (otherBus) {
                if (bus.name !== otherBus.name) updates.push({ type: "BusNameUpdate", id: bus.id!, name: bus.name });
                if (bus.boardingArea !== otherBus.boardingArea) updates.push({ type: "BusBoardingAreaUpdate", id: bus.id!, boardingArea: bus.boardingArea });
                console.log(" ", bus.boardingArea, bus.name, otherBus.name)
            } else {
                updates.push({ type: "BusCreate", id: bus.id, name: bus.name, boardingArea: bus.boardingArea });
            }
        }

        return updates;
    }

    public update(ybbDataModel?: YBBDataModel, sheetsDataModel?: SheetDataModel) {
        console.log("Pre-update GroundTruthDataModel Buses:", this.buses);
        // Diff the changes.
        const ybbChanges = ybbDataModel ? this.diffIncomingChanges(ybbDataModel) : [];
        console.log("Pre-update GroundTruthDataModel Buses 2:", this.buses);
        const sheetsChanges = sheetsDataModel ? this.diffIncomingChanges(sheetsDataModel) : [];
        console.log("Pre-update GroundTruthDataModel Buses 3:", this.buses);

        // Deduplicate the changes, giving priority to YBB changes.
        const changes: BusDifference[] = [];
        const seenNameChanges = new Set<string>();
        const seenBoardingAreaChanges = new Set<string>();
        const seenBusCreationNames = new Set<string | null>();
        ybbChanges.forEach(change => {
            if (change.type === "BusNameUpdate") {
                seenNameChanges.add(change.id);
            } else if (change.type === "BusBoardingAreaUpdate") {
                seenBoardingAreaChanges.add(change.id);
            } else if (change.type === "BusCreate") {
                seenBusCreationNames.add(change.name);
            }
            changes.push(change);
        });
        sheetsChanges.forEach(change => {
            console.log(change);
            if (change.type === "BusNameUpdate" && !seenNameChanges.has(change.id)) {
                seenNameChanges.add(change.id);
                changes.push(change);
            } else if (change.type === "BusBoardingAreaUpdate" && !seenBoardingAreaChanges.has(change.id)) {
                seenBoardingAreaChanges.add(change.id);
                changes.push(change);
            } else if (change.type === "BusCreate" && !seenBusCreationNames.has(change.name)) {
                seenBusCreationNames.add(change.name);
                changes.push(change);
            }
        });

        // Apply the changes.
        changes.forEach(change => {
            if (change.type === "BusNameUpdate") {
                const bus = this.buses.find(bus => bus.id === change.id);
                if (bus) bus.name = change.name;
                console.log(bus?.id, change.id);
            } else if (change.type === "BusBoardingAreaUpdate") {
                const bus = this.buses.find(bus => bus.id === change.id);
                if (bus) bus.boardingArea = change.boardingArea;
            } else if (change.type === "BusCreate") {
                this.buses.push({
                    id: change.id,
                    name: change.name,
                    boardingArea: change.boardingArea,
                    info: undefined,
                });
            }
        });
    }
}


export default interface DataModels {
    sheet: SheetDataModel;
    ybb: YBBDataModel;
    truth: GroundTruthDataModel
}