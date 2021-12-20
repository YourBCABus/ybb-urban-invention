import { Query, hasOwnProperty } from "../context";

const getSchoolQueryText = `
query GetSchool($schoolID: ID!) {
    school(id: $schoolID) {
        timeZone
        buses {
            id
            name
            boardingArea
            invalidateTime
        }
    }
}
`;

export type ValidatedType = {
    school: {
        timeZone: string | null,
        buses: {
            id: string,
            name: string,
            boardingArea?: string,
            invalidateTime?: Date,
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
                            hasOwnProperty(entry, "invalidateTime")
                    ) {
                        const { id, name, boardingArea, invalidateTime } = entry;
                        if (
                            typeof id              === "string" &&
                            typeof name            === "string" &&
                            (typeof boardingArea   === "string" || boardingArea === null)&&
                            (typeof invalidateTime === "string" || invalidateTime === null)
                        ) {
                            return {
                                id,
                                name,
                                boardingArea: boardingArea ?? undefined,
                                invalidateTime: invalidateTime ? new Date(invalidateTime) : undefined,
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
};

export default getSchool;
