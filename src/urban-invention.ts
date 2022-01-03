import YbbContext from "./ybbContext.js";
import SheetContext from "./sheetsIntegration.js";

import DataModels, { GroundTruthDataModel, SheetDataModel, YBBDataModel } from "./dataModel.js";
import { Logger } from "./utils.js";

export var logger = new Logger();

const CRON_MODE_DELAY = 10 * 1000;

async function sync(
    dataModels: DataModels,
    ybbContext: YbbContext,
    sheetContext: SheetContext,
    upDownEnables: {sheetToYbb: boolean, ybbToSheet: boolean},
): Promise<void> {
    logger.log("Starting sync...");
    logger.indent();
    {
        await dataModels.ybb.updateFromYBB(ybbContext);
    
        dataModels.sheet.updateFromSheetAndYbb(await sheetContext.getSheet(), dataModels.ybb);
    
        dataModels.truth.update(dataModels.ybb, dataModels.sheet);



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
                logger.log(`Syncing at ${new Date().toUTCString()}...`);
                await sync(dataModels, ybbContext, sheetContext, upDownEnables);
                logger.reset();
            } catch (e) {
                logger.reset();
                logger.error(e);
                logger.log("Sync interrupted.");
            }
            await new Promise(resolve => setTimeout(resolve, CRON_MODE_DELAY));
        }
    } else {
        try {
            logger.log(`Syncing at ${new Date().toUTCString()}...`);
            await sync(dataModels, ybbContext, sheetContext, upDownEnables);
            logger.reset();
        } catch (e) {
            logger.reset();
            logger.error(e);
            logger.log("Sync interrupted.");
        }
    }
})();

