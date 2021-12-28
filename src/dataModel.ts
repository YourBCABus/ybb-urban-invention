import getSchool from "./queries_mutations/getSchool.js";
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

export interface DataModel<T> {
    buses: BusModel<T>[];
}

export class SheetDataModel implements DataModel<SheetPos> {
    constructor(public buses: SheetBusModel[]) {}

    public updateFromSheet(sheet: string[][]) {
        const usedPositions = new Set<string>();
        this.buses.forEach(bus => bus.updateFromSheet(sheet, usedPositions));
        
        const newBuses = mapPositions(
            sheet,
            (data, pos) => new SheetBusModel(null, data[0].trim(), data[1].trim(), pos),
            (data, pos) => data[0].trim().length !== 0 && !usedPositions.has(`${pos.x},${pos.y}`)
        );
        this.buses.push(...newBuses);
    }

    // Updates the model and applies the change to Google Sheets.
    async applyChange(change: BusDifference) {
        
    }
}

export class YBBDataModel implements DataModel<undefined> {
    constructor(public buses: BusModel<undefined>[]) {}

    public async updateFromYBB(context: YbbContext) {
        const { school } = await context.query(getSchool, {schoolID: context.schoolId});
        this.buses = school.buses.map(bus => ({
            id: bus.id,
            name: bus.name ?? null,
            boardingArea: bus.boardingArea ?? null,
            info: undefined,
        }));
    }

    // Updates the model and applies the change to the YourBCABus API.
    async applyChange(change: BusDifference) {

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
    name: string | null;
    boardingArea: string | null;
}

type BusDifference = BusNameUpdate | BusBoardingAreaUpdate | BusCreate;

export class GroundTruthDataModel implements DataModel<undefined> {
    constructor(public buses: BusModel<undefined>[]) {}

    // Diffs the two data models and returns a list of updates and new buses in other.
    diffIncomingChanges(other: DataModel<unknown>): BusDifference[] {
        const updates: BusDifference[] = [];
        const newBuses: BusModel<any>[] = [];
        const otherBuses = other.buses;
        for (const bus of this.buses) {
            const otherBus = otherBuses.find(otherBus => otherBus.id === bus.id);
            if (otherBus) {
                if (bus.name !== otherBus.name) updates.push({ type: "BusNameUpdate", id: bus.id!, name: bus.name });
                if (bus.boardingArea !== otherBus.boardingArea) updates.push({ type: "BusBoardingAreaUpdate", id: bus.id!, boardingArea: bus.boardingArea });
            }
        }

        for (const bus of otherBuses) {
            if (!this.buses.some(thisBus => thisBus.id === bus.id)) newBuses.push(bus);
        }

        return [...updates, ...newBuses.map(bus => ({ type: "BusCreate", name: bus.name, boardingArea: bus.boardingArea } as BusCreate))];
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
                updates.push({ type: "BusCreate", name: bus.name, boardingArea: bus.boardingArea });
            }
        }

        return updates;
    }

    public update(ybbDataModel?: YBBDataModel, sheetsDataModel?: SheetDataModel) {
        // Diff the changes.
        const ybbChanges = ybbDataModel ? this.diffIncomingChanges(ybbDataModel) : [];
        const sheetsChanges = sheetsDataModel ? this.diffIncomingChanges(sheetsDataModel) : [];

        // Deduplicate the changes.
        const changes: BusDifference[] = [];
        const seenNameChanges = new Set<string>();
        const seenBoardingAreaChanges = new Set<string>();
        ybbChanges.forEach(change => {
            if (change.type === "BusNameUpdate") {
                seenNameChanges.add(change.id);
            } else if (change.type === "BusBoardingAreaUpdate") {
                seenBoardingAreaChanges.add(change.id);
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
            } else if (change.type === "BusCreate") {
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
                this.buses.push({
                    id: null,
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