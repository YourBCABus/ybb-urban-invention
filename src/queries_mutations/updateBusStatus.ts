import { Query } from "../ybbContext.js";
import { hasOwnProperty } from "../utils.js";


const updateBusStatusMutationText = `
mutation UpdateBusStatus($busID: ID!, $boardingArea: String, $invalidateTime: DateTime!) {
    updateBusStatus(busID: $busID, status: {boardingArea: $boardingArea, invalidateTime: $invalidateTime}) {
        id
    }
}
`;

export type ValidatedType = {
    updateBusStatus: {
        id: string
    },
};


function validateFunction(input: unknown): ValidatedType {
    if (
        (typeof input === "object" && input !== null) &&
            hasOwnProperty(input, "updateBusStatus")
    ) {
        const updateBusStatus = input.updateBusStatus;
        if (
            typeof updateBusStatus === "object" && updateBusStatus !== null &&
                hasOwnProperty(updateBusStatus, "id")
        ) {
            const id = updateBusStatus.id;
            if (
                typeof id === "string"
            ) {
                return { updateBusStatus: { id }};
            }
        }
    }
    throw new TypeError("The query result does not match the expected shape.\n" + JSON.stringify(input));
}

function formatVariables(
    busID: string,
    boardingArea: string | undefined,
    invalidateTime: string
) {
    const fallbackDate = new Date();
    fallbackDate.setHours(0);
    fallbackDate.setMinutes(0);
    fallbackDate.setSeconds(0);
    fallbackDate.setMilliseconds(0);
    
    return {
        busID,
        boardingArea,
        invalidateTime: !boardingArea?.trim() || boardingArea.trim() === "?"
            ? fallbackDate.toISOString()
            : invalidateTime,
    };
}

const updateBusStatus: Query<ValidatedType, typeof formatVariables> = {
    queryText: updateBusStatusMutationText,
    formatVariables,
    validateFunction,
};

export default updateBusStatus;