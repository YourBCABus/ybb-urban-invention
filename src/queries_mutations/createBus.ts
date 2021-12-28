import { Query } from "../ybbContext.js";
import { hasOwnProperty } from "../utils.js";

const createBusMutationText = `
mutation CreateBus($schoolID: ID!, $name: String) {
    createBus(schoolID: $schoolID, bus: {name: $name, otherNames: [], phone: [], available: true}) {
        id
    }
}
`;

export type ValidatedType = { createBus: { id: string } };

function validateFunction(input: unknown): ValidatedType {
    if (
        (typeof input === "object" && input !== null) &&
            hasOwnProperty(input, "createBus")
    ) {
        const createBus = input.createBus;
        if (
            typeof createBus === "object" && createBus !== null &&
                hasOwnProperty(createBus, "id")
        ) {
            const id = createBus.id;
            if (
                typeof id === "string"
            ) {
                return { createBus: { id }};
            }
        }
    }
    throw new TypeError("The query result does not match the expected shape.\n" + JSON.stringify(input));
}

function formatVariables(
    schoolID: string,
    name: string,
) {
    return {schoolID, name};
}

const createBus: Query<ValidatedType, typeof formatVariables> = {
    queryText: createBusMutationText,
    formatVariables,
    validateFunction,
};

export default createBus;
