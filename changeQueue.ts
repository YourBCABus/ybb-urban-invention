export type BoardingAreaChangeMessage = {
    schoolID: string,
    busID: string,
    busName: string,
    newBoardingArea: string,
};

export type BusNameChangeMessage = {
    // TODO: Implement.
};

export type NewBusCreationMessage = {
    // TODO: Implement.
};

type Change = 
    {tag: "BAC", data: BoardingAreaChangeMessage} |
    {tag: "BNC", data: BusNameChangeMessage} |
    {tag: "NBC", data: NewBusCreationMessage};


export default class ChangeQueue {
    private changes: Change[];

    public constructor() {
        this.changes = [];
    }

    private rebuildMap(sheet: readonly (readonly string[])[]): Map<string, [number, number]> {
        const map = new Map();
        sheet.forEach((row, idx) => {
            for (let i = 0; i < row.length; i += 3) {
                if (!map.has(row[i].trim())) {
                    map.set(row[i].trim(), [idx, i]);
                }
            }
        });
        return map;
    }

    private applyChanges(sheet: readonly (readonly string[])[], map: Map<string, [number, number]>, changes: Change[]): readonly (readonly string[])[] {
        const mutableSheet = sheet.map(row => row.map(cell => cell));

        for (const change of changes) {
            switch (change.tag) {
                case "BAC": {
                    const location = map.get(change.data.busName)!;
                    mutableSheet[location[0]][location[1]] = change.data.busName;
                    mutableSheet[location[0]][location[1] + 1] = change.data.newBoardingArea;
                    
                    break;
                }

                case "BNC": {
                    // TODO: Implement.
                    break;
                }
                
                case "NBC":
                    // TODO: Implement.
                    break;
            }
            mutableSheet.push();
        }

        return mutableSheet;
    }

    public updateSheetTarget(sheet: readonly (readonly string[])[]): readonly (readonly string[])[] {
        const changes = this.changes;
        this.clearQueue();

        const map = this.rebuildMap(sheet);
        
        return this.applyChanges(sheet, map, changes);
        
    }

    public clearQueue() {
        this.changes = [];
    }

    public queueBoardingAreaChange(message: BoardingAreaChangeMessage) {
        this.changes.push({ tag: "BAC", data: message });
    }

    public queueBusNameChange(message: BusNameChangeMessage) {
        this.changes.push({ tag: "BNC", data: message });
    }

    public queueNewBusCreation(message: NewBusCreationMessage) {
        this.changes.push({ tag: "NBC", data: message });
    }
}
