import { DateTime } from "https://raw.githubusercontent.com/moment/luxon/2.0.2/src/luxon.js";

import { Query, hasOwnProperty } from "../context.ts";


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
    
    return {
        busID,
        boardingArea,
        invalidateTime: !boardingArea?.trim() || boardingArea.trim() === "?"
            ? DateTime.now().startOf("day").toUTC().toISO()
            : invalidateTime,
    };
}

const updateBusStatus: Query<ValidatedType, typeof formatVariables> = {
    queryText: updateBusStatusMutationText,
    formatVariables,
    validateFunction,
};

export default updateBusStatus;