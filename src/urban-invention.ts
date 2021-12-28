import YbbContext from "./ybbContext.js";
import SheetContext from "./sheetsIntegration.js";

import DataModels, { GroundTruthDataModel, SheetDataModel, YBBDataModel } from "./dataModel.js";

const CRON_MODE_DELAY = 30 * 1000;

async function sync(
    dataModels: DataModels,
    ybbContext: YbbContext,
    sheetContext: SheetContext,
    upDownEnables: {sheetToYbb: boolean, ybbToSheet: boolean},
): Promise<void> {
    console.log("Starting sync...");

    await dataModels.ybb.updateFromYBB(ybbContext);

    dataModels.sheet.updateFromSheet(await sheetContext.getSheet());

    // Poll the Google Sheet to get an update on the location of the buses.

    if (upDownEnables.sheetToYbb) {
        console.error("`upDownEnables.sheetToYbb` is unimplemented.");
    }

    if (upDownEnables.ybbToSheet) {
        console.error("`upDownEnables.ybbToSheet` is unimplemented.");
    }
}

const upDownEnables = { ybbToSheet: true, sheetToYbb: true };

(async () => {
    const dataModels: DataModels = {
        ybb: new YBBDataModel([]),
        sheet: new SheetDataModel([]),
        truth: new GroundTruthDataModel([]),
    };

    const [ybbContext, sheetContext] = await Promise.all([
        YbbContext.newFromFile(process.env.SCHOOL_ID!, "ybb-credentials.json"),
        SheetContext.authenticateAndCreate(process.env.SPREADSHEET_ID!),
    ]);

    

    if (process.env.CRON_MODE) {
        while (true) {
            try {
                await sync(dataModels, ybbContext, sheetContext, upDownEnables);
            } catch (e) {
                console.error(e);
                console.log("Sync interrupted.");
            }
            await new Promise(resolve => setTimeout(resolve, CRON_MODE_DELAY));
        }
    } else {
        try {
            await sync(dataModels, ybbContext, sheetContext, upDownEnables);
        } catch (e) {
            console.error(e);
            console.log("Sync interrupted.");
        }
    }
})();

