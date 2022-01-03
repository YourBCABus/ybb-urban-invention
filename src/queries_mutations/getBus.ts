import { Query } from "../ybbContext.js";
import { hasOwnProperty } from "../utils.js";

const getBusQueryText = `
query GetBus($busID: ID!) {
    bus(id: $busID) {
        name
        available
        otherNames
        phone
        company
    }
}
`;

export type ValidatedType = {
    bus: {
        name: string | null,
        available: boolean,
        otherNames: string[],
        phone: string[],
        company: string | null,
    },
};

function validateFunction(input: unknown): ValidatedType {
    if (
        (typeof input === "object" && input !== null) &&
        hasOwnProperty(input, "bus")
    ) {
        const bus = input.bus;
        if (
            typeof bus === "object" && bus !== null &&
            hasOwnProperty(bus, "name") &&
            hasOwnProperty(bus, "available") &&
            hasOwnProperty(bus, "otherNames") &&
            hasOwnProperty(bus, "phone") &&
            hasOwnProperty(bus, "company")
        ) {
            const { name, available, otherNames, phone, company } = bus;
            if (
                (typeof name === 'string' || name === null) &&
                typeof available === 'boolean' &&
                (Array.isArray(otherNames) && otherNames.findIndex(otherName => typeof otherName !== 'string') === -1) &&  
                (Array.isArray(phone) && phone.findIndex(item => typeof item !== 'string') === -1) &&  
                (typeof company === 'string' || company === null)
            ) {
                return {
                    bus: {
                        name,
                        available,
                        otherNames,
                        phone,
                        company,
                    }
                };
            }
        }
    }
    throw new TypeError("The query result does not match the expected shape.\n" + JSON.stringify(input));
}

function formatVariables(
    busID: string,
) {
    return { busID };
}

const getBus: Query<ValidatedType, typeof formatVariables> = {
    queryText: getBusQueryText,
    formatVariables,
    validateFunction,
    queryName: "getBus",
};

export default getBus;
