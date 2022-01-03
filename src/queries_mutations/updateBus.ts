import { Query } from "../ybbContext.js";
import { hasOwnProperty } from "../utils.js";

const updateBusMutationText = `
mutation UpdateBus($schoolID: ID!, $bus: BusInput!) {
    updateBus(schoolID: $schoolID, bus: $bus) {
        id
    }
}
`;

export type ValidatedType = { updateBus: { id: string } };

function validateFunction(input: unknown): ValidatedType {
    if (
        (typeof input === "object" && input !== null) &&
        hasOwnProperty(input, "updateBus")
    ) {
        const updateBus = input.updateBus;
        if (
            typeof updateBus === "object" && updateBus !== null &&
            hasOwnProperty(updateBus, "id")
        ) {
            const id = updateBus.id;
            if (
                typeof id === "string"
            ) {
                return { updateBus: { id } };
            }
        }
    }
    throw new TypeError("The query result does not match the expected shape.\n" + JSON.stringify(input));
}

function formatVariables(
    busID: string,
    bus: {
        name: string | null,
        otherNames: string[],
        available: boolean,
        company: string | null,
        phone: string[],
    },
) {
    return { busID, bus };
}

const updateBus: Query<ValidatedType, typeof formatVariables> = {
    queryText: updateBusMutationText,
    formatVariables,
    validateFunction,
    queryName: 'updateBus',
};

export default updateBus;
