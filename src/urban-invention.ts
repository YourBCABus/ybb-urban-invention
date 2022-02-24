import YbbContext from "./ybbContext.js";
import SheetContext from "./sheetsIntegration.js";
import fetch from "node-fetch";

import DataModels, { GroundTruthDataModel, SheetDataModel, YBBDataModel } from "./dataModel.js";
import { Logger } from "./utils.js";

export var logger = new Logger();

const CRON_MODE_DELAY = 10 * 1000;

async function sync(
    dataModels: DataModels,
    ybbContext: YbbContext,
    sheetContext: SheetContext,
    upDownEnables: {sheetToYbb: boolean, ybbToSheet: boolean},
    firstRun: boolean,
): Promise<void> {
    logger.log("Starting sync...");
    logger.indent();
    {
        await dataModels.ybb.updateFromYBB(ybbContext);
    
        logger.log("Updating sheet model from new data...");
        logger.indent();
        {
            const sheetData = await sheetContext.getSheet();
            dataModels.sheet.updateFromSheetAndYbb(sheetData, dataModels.ybb);
        }
        logger.unindent();
    
        dataModels.truth.update(firstRun, dataModels.ybb, dataModels.sheet);



        logger.log("Persisting new data to sheet/ybb...");
        
        if (upDownEnables.sheetToYbb) {
            logger.indent();
            {
                logger.log("Getting outgoing changes...");
                const outgoingChanges = dataModels.truth.diffOutgoingChanges(
                    dataModels.ybb,
                );
            
                logger.log("Applying changes to YBB...");
                await dataModels.ybb.applyChanges(
                    outgoingChanges,
                    ybbContext,
                );
            }
            logger.unindent();
        }
    
        if (upDownEnables.ybbToSheet) {
            logger.indent();
            {
                logger.log("Getting outgoing changes...");
                const outgoingChanges = dataModels.truth.diffOutgoingChanges(
                    dataModels.sheet,
                );
                
                logger.log("Applying changes to sheet...");
                await dataModels.sheet.applyChanges(
                    outgoingChanges,
                    sheetContext,
                );
            }
            logger.unindent();
        }
    }
    logger.unindent();
}

const upDownEnables = { ybbToSheet: !process.env.DISABLE_WRITING_TO_SHEET, sheetToYbb: true };

(async () => {
    const dataModels: DataModels = {
        ybb: new YBBDataModel([], []),
        sheet: new SheetDataModel([]),
        truth: new GroundTruthDataModel([]),
    };

    const [ybbContext, sheetContext] = await Promise.all([
        YbbContext.newFromFile(process.env.SCHOOL_ID!, "ybb-credentials.json"),
        SheetContext.authenticateAndCreate(process.env.SPREADSHEET_ID!),
    ]);

    

    if (process.env.CRON_MODE) {
        let firstRun = true;
        while (true) {
            try {
                logger.log(`Syncing at ${new Date().toUTCString()}...`);
                await sync(dataModels, ybbContext, sheetContext, upDownEnables, firstRun);
                logger.reset();
                (async () => {
                    try {
                        await fetch(`https://api.yourbcabus.com/urban-invention-uptime?token=${process.env.UI_TOKEN}`, { method: "PUT" });
                    } catch (e) {
                        logger.log("Couldn't ping fantastic-umbrella.");
                    }
                })();
            } catch (e) {
                logger.reset();
                logger.error(e);
                logger.log("Sync interrupted.");
            }
            firstRun = false;
            await new Promise(resolve => setTimeout(resolve, CRON_MODE_DELAY));
        }
    } else {
        try {
            logger.log(`Syncing at ${new Date().toUTCString()}...`);
            await sync(dataModels, ybbContext, sheetContext, upDownEnables, true);
            logger.reset();
        } catch (e) {
            logger.reset();
            logger.error(e);
            logger.log("Sync interrupted.");
        }
    }
})();

