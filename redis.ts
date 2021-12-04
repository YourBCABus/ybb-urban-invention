import { connect, RedisSubscription } from "https://deno.land/x/redis/mod.ts";

import { crypto } from "https://deno.land/std@0.117.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.117.0/encoding/base64.ts";
import ChangeQueue, { BoardingAreaChangeMessage } from "./changeQueue.ts";

const id = Deno.env.get("YBB_CLIENT_ID") ?? "000000000000000000000000";
const redisHostName = Deno.env.get("REDIS_HOST") ?? "localhost";
const redisPort = parseInt(Deno.env.get("REDIS_PORT") ?? "6379");
const redisDb = parseInt(Deno.env.get("REDIS_DB") ?? "0");

let called = false;

export default function initRedis(changeQueue: ChangeQueue) {
    if (!called) {
        called = true;
        return _initRedis(changeQueue);
    }

}

function zipArrays<T, K>(arr1: T[], arr2: K[]): [T, K][] {
    return Array(Math.max(arr1.length, arr2.length)).fill(null).map((_, idx) => [arr1[idx], arr2[idx]]);
}

type Unpromisified<T> = T extends Promise<infer ContainedType> ? ContainedType : T;
type PromiseAllValuesReturnType<T> = {[K in keyof T]: Unpromisified<T[K]>};

async function promiseAllValues<T>(obj: T): Promise<PromiseAllValuesReturnType<T>> {
    return Object.fromEntries(zipArrays(Object.keys(obj), await Promise.all(Object.values(obj)))) as PromiseAllValuesReturnType<T>;
}

type SubscriptionPromise = Promise<RedisSubscription<string>>

type SubscriptionPromises = {
    boardingAreaChange: SubscriptionPromise,
    // TODO: Implement subscription to other channels.
};



async function getSubscriptions(): Promise<PromiseAllValuesReturnType<SubscriptionPromises>> {
    const redis = await connect({hostname: redisHostName, port: redisPort, db: redisDb});
    
    const subscriptionPromises: SubscriptionPromises = {
        boardingAreaChange: redis.subscribe("BUS_BOARDING_AREA_CHANGE")
    };


    return promiseAllValues(subscriptionPromises);
}

async function _initRedis(changeQueue: ChangeQueue) {
    const { boardingAreaChange } = await getSubscriptions();

    const hash = encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));

    (async () => {

        for await (const { message } of boardingAreaChange.receive()) {
            console.log(message);
            const messageObj: BoardingAreaChangeMessage = JSON.parse(message);

            if (hash === messageObj.clientHash) continue;
            console.log({client: hash, server: messageObj.clientHash});
            changeQueue.queueBoardingAreaChange(messageObj);
        }
    })();
}
