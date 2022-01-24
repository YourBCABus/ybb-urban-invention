import { Query } from "../ybbContext.js";
import { hasOwnProperty } from "../utils.js";

const getSchoolQueryText = `
query GetSchool($schoolID: ID!) {
    school(id: $schoolID) {
        timeZone
        buses {
            id
            name
            boardingArea
            invalidateTime
            available
        }
    }
}
`;

export type ValidatedType = {
    school: {
        timeZone: string | null,
        buses: {
            id: string,
            name?: string,
            boardingArea?: string,
            invalidateTime?: Date,
            available: boolean
        }[]
    },
    
};

function validateFunction(input: unknown): ValidatedType {
    if (
        (typeof input === "object" && input !== null) &&
            hasOwnProperty(input, "school")
    ) {
        const school = input.school;
        if (
            typeof school === "object" && school !== null &&
                hasOwnProperty(school, "timeZone") &&
                hasOwnProperty(school, "buses")
        ) {
            const { timeZone, buses } = school;
            if (
                (typeof timeZone === "string" || timeZone === null) &&
                Array.isArray(buses)
            ) {
                const busesArr = buses.map((entry: unknown) => {
                    if (
                        typeof entry === "object" && entry !== null &&
                            hasOwnProperty(entry, "id") &&
                            hasOwnProperty(entry, "name") &&
                            hasOwnProperty(entry, "boardingArea") &&
                            hasOwnProperty(entry, "invalidateTime") &&
                            hasOwnProperty(entry, "available")
                    ) {
                        const { id, name, boardingArea, invalidateTime, available } = entry;
                        if (
                            (typeof id             === "string") &&
                            (typeof name           === "string" || name           === null) &&
                            (typeof boardingArea   === "string" || boardingArea   === null) &&
                            (typeof invalidateTime === "string" || invalidateTime === null) &&
                            (typeof available      === "boolean")
                        ) {
                            return {
                                id,
                                name: name ?? undefined,
                                boardingArea: boardingArea ?? undefined,
                                invalidateTime: invalidateTime ? new Date(invalidateTime) : undefined,
                                available,
                            };
                        }
                    }
                    throw new TypeError("The query result does not match the expected shape.\n" + JSON.stringify(input));
                });
                return {
                    school: {
                        timeZone,
                        buses: busesArr,
                    }
                };
            }
        }
    }
    throw new TypeError("The query result does not match the expected shape.\n" + JSON.stringify(input));
}

function formatVariables(
    schoolID: string,
) {
    return { schoolID };
}

const getSchool: Query<ValidatedType, typeof formatVariables> = {
    queryText: getSchoolQueryText,
    formatVariables,
    validateFunction,
    queryName: "getSchool",
};

export default getSchool;
